import { GitHubService } from './github';
import { CardElement, CardSelector } from './types';
import './content.css';

class CardStatsOverlay {
  private githubService: GitHubService;
  private isInitialized = false;
  
  // Оптимизация для больших объемов данных
  private intersectionObserver: IntersectionObserver | null = null;
  private retryAttempts = 0;
  private maxRetryAttempts = 3;
  private retryDelay = 1000; // 1 секунда

  // Защита от утечек памяти
  private readonly MAX_TOTAL_OVERLAYS = 200; // Максимум оверлеев на странице
  private readonly CLEANUP_INTERVAL = 30000; // Очистка каждые 30 секунд
  private cleanupTimer: number | null = null;
  private currentOverlaysCount = 0;

  // Кэширование для ускорения
  private cardIdCache: Map<string, number> = new Map(); // URL -> cardId
  private statsCache: Map<number, any> = new Map(); // cardId -> stats
  private processingIds: Set<string> = new Set(); // Защита от дублирования remelt карт
  
  // Navigation debug properties
  private lastNavigationStart: number = 0;
  private navigationCounter: number = 0;

  // Оптимизация обработки
  private lastProcessTime: number = 0;
  private readonly PROCESS_DEBOUNCE_DELAY = 500; // Увеличили задержку для реального debouncing

  // Система отслеживания активности пользователя
  private isUserActive = true;
  private userInactivityTimer: number | null = null;
  private readonly USER_INACTIVITY_TIMEOUT = 30000; // 30 секунд неактивности
  private wasProcessingPaused = false;
  private pendingCards: Set<HTMLElement> = new Set(); // Карты, ожидающие обработки

  // Селекторы для разных типов карт на сайте
  private cardSelectors: CardSelector[] = [
    {
      selector: '.anime-cards__item-wrapper',
      dataIdAttribute: 'data-id',
      dataNameAttribute: 'data-name',
      insertionMethod: 'append',
      targetSelector: '.anime-cards__item-wrapper'
    },
    {
      selector: '.trade__inventory-item img[src*="/uploads/cards_image/"]', // Только по URL изображения для трейдов
      dataIdAttribute: 'src',
      insertionMethod: 'append',
      targetSelector: '.trade__inventory-item', // Вставляем в родительский элемент
      extractFromImage: true // Используем URL изображения для поиска в БД
    },
    {
      selector: '.trade__main-item',
      dataIdAttribute: 'href',
      insertionMethod: 'append'
    },
    {
      selector: '.trade__item img[src*="/uploads/cards_image/"]', // Только по URL изображения для трейдов
      dataIdAttribute: 'src',
      insertionMethod: 'append',
      targetSelector: '.trade__item', // Вставляем в родительский элемент
      extractFromImage: true
    },
    {
      selector: '.inventory-card', // Для карт в инвентаре (не трейд страница)
      dataIdAttribute: 'data-card-id',
      insertionMethod: 'append'
    },
    {
      selector: '.history__body-item',
      dataIdAttribute: 'href',
      insertionMethod: 'append'
    },
    {
      selector: '.lootbox__card', // Все карточки из лутбоксов (с любыми дополнительными классами)
      dataIdAttribute: 'data-id',
      insertionMethod: 'append',
      extractFromImage: true // Lootbox cards need image URL lookup
    },
    {
      selector: '.remelt__inventory-item img[src*="/uploads/cards_image/"]', // Карточки на страницах remelt
      dataIdAttribute: 'src',
      insertionMethod: 'append',
      targetSelector: '.remelt__inventory-item', // Вставляем в родительский элемент
      extractFromImage: true // Используем URL изображения для поиска в БД
    },
    {
      selector: '.owl-item a[href*="/cards/users/?id="]', // Карточки в owl-carousel
      dataIdAttribute: 'href',
      insertionMethod: 'append'
    },
    {
      selector: '.trade__inventory-item img[src*="/uploads/cards_image/"]', // Карточки по URL изображения
      dataIdAttribute: 'src',
      insertionMethod: 'append',
      extractFromImage: true,
      targetSelector: '.trade__inventory-item' // Вставляем overlay в родительский элемент
    }
  ];

  constructor() {
    this.githubService = new GitHubService();
    this.startCleanupTimer();
    this.setupUserActivityTracking();
  }

  private setupUserActivityTracking(): void {
    // События активности пользователя
    const activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
    
    activityEvents.forEach(event => {
      document.addEventListener(event, () => this.handleUserActivity(), { passive: true });
    });

    // События смены видимости страницы
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.handleUserReturned();
      } else {
        this.handleUserLeft();
      }
    });

    console.log('👁️ User activity tracking set up');
  }

  /**
   * Проверяет, находимся ли мы на странице без лимита оверлеев (трейды и ремелт)
   */
  private isUnlimitedPage(): boolean {
    const path = window.location.pathname;
    return path.includes('/trade/') || path.includes('/cards_remelt/');
  }

  private handleUserActivity(): void {
    if (!this.isUserActive) {
      console.log('🔄 User became active, resuming processing');
      this.isUserActive = true;
      this.resumeProcessing();
    }

    // Сбрасываем таймер неактивности
    if (this.userInactivityTimer) {
      clearTimeout(this.userInactivityTimer);
    }

    this.userInactivityTimer = window.setTimeout(() => {
      this.handleUserInactivity();
    }, this.USER_INACTIVITY_TIMEOUT);
  }

  private handleUserInactivity(): void {
    console.log('😴 User inactive, pausing processing');
    this.isUserActive = false;
    this.wasProcessingPaused = true;
  }

  private handleUserLeft(): void {
    console.log('📴 User switched tab/minimized, pausing processing');
    this.isUserActive = false;
    this.wasProcessingPaused = true;
  }

  private handleUserReturned(): void {
    console.log('📱 User returned to tab, resuming processing');
    this.isUserActive = true;
    this.resumeProcessing();
  }

  private resumeProcessing(): void {
    if (this.wasProcessingPaused) {
      console.log('🔄 Resuming processing after pause');
      this.wasProcessingPaused = false;
      
      // Обрабатываем отложенные карты
      if (this.pendingCards.size > 0) {
        console.log(`📦 Processing ${this.pendingCards.size} pending cards`);
        const cardsToProcess = Array.from(this.pendingCards);
        this.pendingCards.clear();
        this.processVisibleCards(cardsToProcess);
      }
      
      // Запускаем полную переобработку для догрузки пропущенного
      setTimeout(() => {
        this.processExistingCardsDebounced();
      }, 1000);
    }
  }

  async init(): Promise<void> {
    if (this.isInitialized) return;

    try {
      await this.initWithRetry();
    } catch (error) {
      console.error('❌ Failed to initialize extension after retries:', error);
      // Пытаемся еще раз через 5 секунд
      setTimeout(() => this.init(), 5000);
    }
  }

  private async initWithRetry(): Promise<void> {
    for (let attempt = 1; attempt <= this.maxRetryAttempts; attempt++) {
      try {
        console.log(`🚀 Initializing AnimestarsCards Stats Extension... (attempt ${attempt}/${this.maxRetryAttempts})`);
        
        // Ждем готовности страницы
        if (document.readyState !== 'complete') {
          await new Promise(resolve => {
            if (document.readyState === 'complete') {
              resolve(void 0);
            } else {
              window.addEventListener('load', resolve, { once: true });
            }
          });
        }

        // Проверяем доступность background script с попыткой активации
        let pingResponse;
        try {
          // Первая попытка - простой ping
          pingResponse = await chrome.runtime.sendMessage({ type: 'ping' });
        } catch (error) {
          console.log('🔄 Background script inactive, attempting to wake up...');
          
          // Даем время service worker проснуться
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Повторная попытка
          try {
            pingResponse = await chrome.runtime.sendMessage({ type: 'ping' });
          } catch (secondError) {
            console.log('🔄 Second attempt to wake background script...');
            
            // Еще одна попытка с большей задержкой
            await new Promise(resolve => setTimeout(resolve, 500));
            pingResponse = await chrome.runtime.sendMessage({ type: 'ping' });
          }
        }
        
        if (!pingResponse?.success) {
          throw new Error('Background script not ready');
        }
        
        console.log('✅ Using background database service');

        // Проверяем, есть ли данные в базе через background
        const cardsResponse = await chrome.runtime.sendMessage({ type: 'getCardsCount' });
        const cardsCount = cardsResponse.success ? cardsResponse.data : 0;
        
        if (cardsCount === 0) {
          console.log('📥 No data yet, background is loading. Extension will work when data is ready.');
        } else {
          console.log(`📊 Database ready with ${cardsCount} cards`);
        }

        this.isInitialized = true;
        
        // Определяем тип страницы
        const pageType = this.getPageType();
        console.log(`✅ Extension initialized successfully on ${pageType} page`);

        // Инициализируем ленивую загрузку
        this.initLazyLoading();

        // Слушаем обновления базы данных от background
        this.setupMessageListener();

        // Запускаем мониторинг изменений DOM
        this.startDOMObserver();

        // Настраиваем триггеры для кнопок навигации
        this.setupNavigationTriggers();
      
      // Обрабатываем уже существующие карты
      this.processExistingCardsDebounced();

      return; // Успешная инициализация
      
    } catch (error) {
      console.error(`❌ Error on attempt ${attempt}:`, error);
      
      if (attempt < this.maxRetryAttempts) {
        console.log(`⏳ Retrying in ${this.retryDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        this.retryDelay *= 2; // Exponential backoff
      } else {
        throw error;
      }
    }
  }
}

  private initLazyLoading(): void {
    // Инициализируем IntersectionObserver для ленивой загрузки
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        const visibleCards = entries
          .filter(entry => entry.isIntersecting)
          .map(entry => entry.target as HTMLElement);
        
        if (visibleCards.length > 0) {
          console.log(`👀 IntersectionObserver: ${visibleCards.length} cards became visible`);
          this.processVisibleCards(visibleCards);
        }
      },
      {
        root: null,
        rootMargin: '50px', // Загружаем чуть раньше появления на экране
        threshold: 0.1
      }
    );
  }

  private async processVisibleCards(cards: HTMLElement[]): Promise<void> {
    // Проверяем активность пользователя
    if (!this.isUserActive) {
      console.log('😴 User inactive, adding cards to pending queue');
      cards.forEach(card => this.pendingCards.add(card));
      return;
    }

    // Обрабатываем все видимые карты параллельно для максимальной скорости
    await Promise.all(
      cards.map(async (cardElement) => {
        // Повторно проверяем активность для каждой карты
        if (!this.isUserActive) {
          this.pendingCards.add(cardElement);
          return;
        }

        // Найдем подходящий селектор
        const matchingSelector = this.cardSelectors.find(selector => 
          cardElement.matches(selector.selector)
        );
        
        if (matchingSelector) {
          const cardId = await this.extractCardIdAsync(cardElement, matchingSelector);
          const cardName = this.extractCardName(cardElement, matchingSelector);
          
          if (cardId && !cardElement.querySelector('.card-stats-overlay')) {
            // Обрабатываем немедленно без ожидания
            this.addStatsOverlay({
              element: cardElement,
              cardId,
              cardName
            }).catch(error => {
              console.error('Error processing card:', cardId, error);
            });
          }
        }
      })
    );
  }

  private processExistingCardsDebounced(): void {
    const now = Date.now();
    if (now - this.lastProcessTime < this.PROCESS_DEBOUNCE_DELAY) {
      return; // Слишком частые вызовы
    }
    this.lastProcessTime = now;

    // Проверяем активность пользователя
    if (!this.isUserActive) {
      console.log('😴 User inactive, skipping processExistingCards');
      return;
    }
    
    // Используем debouncing для избежания избыточных вызовов
    setTimeout(() => {
      // Повторно проверяем активность перед обработкой
      if (this.isUserActive) {
        this.processExistingCards();
      }
    }, this.PROCESS_DEBOUNCE_DELAY);
  }

  private setupMessageListener(): void {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'databaseUpdated') {
        console.log(`🔄 Database updated: ${message.data.cardsCount} cards`);
        
        // Очищаем флаги обработки для пересоздания статистики
        this.clearAllProcessedFlags();
        
        // Перерисовываем все карты с новыми данными
        setTimeout(() => {
          this.processExistingCardsDebounced();
        }, 500); // Даем время на завершение обновления БД
      }
    });
  }

  private setupNavigationTriggers(): void {
    console.log(`🎯 Checking URL for navigation triggers: ${window.location.pathname}`);
    
    // Проверяем, что мы на trade, lootbox или remelt странице
    const isTradePageUrl = window.location.pathname.includes('/trade/');
    const isLootboxPageUrl = window.location.pathname.includes('/pack/');
    const isRemeltPageUrl = window.location.pathname.includes('/cards_remelt/');
    
    if (!isTradePageUrl && !isLootboxPageUrl && !isRemeltPageUrl) {
      console.log('❌ Not a trade, lootbox, or remelt page, skipping navigation triggers');
      return;
    }

    if (isTradePageUrl) {
      console.log('🎯 Setting up navigation triggers for trade page');

      // Селекторы кнопок навигации и фильтров для trade page
      const triggerSelectors = [
        '.tabs__want__card',        // Кнопка "Хочет"
        '.tabs__donthave__card',    // Кнопка "Не владеет"  
        '.tabs__hide__lock',        // Кнопка замка
        '#prev_trade_page',         // Предыдущая страница
        '#next_trade_page',         // Следующая страница
        '#info_trade_page',         // Информация о странице
        '.card-trade-list__pagination-item'  // Любые элементы пагинации
      ];

      this.setupTriggers(triggerSelectors);
    } else if (isRemeltPageUrl) {
      console.log('🎯 Setting up navigation triggers for remelt page');

      // Селекторы кнопок навигации и фильтров для remelt page
      const triggerSelectors = [
        '#prev_filter_page',        // Предыдущая страница
        '#next_filter_page',        // Следующая страница
        '#info_filter_page',        // Информация о странице
        '#choose_filter_page',      // Селектор выбора страницы
        '.card-filter-list__pagination-item',  // Любые элементы пагинации
        '.remelt__rank-item',       // Кнопки фильтра по рангу (A, B, C, D, E, Все)
        '.remelt__lock-item',       // Кнопки блокировки/разблокировки
        '.category-type'            // Селект сортировки (по дате/названию)
      ];

      this.setupTriggers(triggerSelectors);
    } else if (isLootboxPageUrl) {
      console.log('🎰 Setting up lootbox card click triggers');
      
      // Обработчик кликов по картам в лутбоксах
      document.addEventListener('click', (event) => {
        const target = event.target as Element;
        const lootboxCard = target.closest('.lootbox__card');
        
        if (lootboxCard) {
          console.log('🎰 Lootbox card clicked, clearing processed flags');
          
          // Очищаем флаги для всех карт лутбокса для переобработки
          setTimeout(() => {
            const allLootboxCards = document.querySelectorAll('.lootbox__card[data-animestars-processed]');
            allLootboxCards.forEach(card => {
              card.removeAttribute('data-animestars-processed');
            });
            
            // Перерендерим статистику через debouncing
            this.processExistingCardsDebounced();
          }, 1000); // Даем время для завершения анимации/обновления карт
        }
      });
      
      console.log('✅ Lootbox triggers set up');
    }
  }

  private setupTriggers(triggerSelectors: string[]): void {
    // Сохраняем селекторы для использования в едином обработчике
    this.activeTriggerSelectors = triggerSelectors;
    
    // Добавляем один обработчик для всех селекторов
    console.log(`🎯 Setting up unified trigger handler for ${triggerSelectors.length} selectors`);
    
    triggerSelectors.forEach(selector => {
      console.log(`🎯 Adding trigger for: ${selector}`);
      const existingElements = document.querySelectorAll(selector);
      console.log(`🔍 Found ${existingElements.length} existing elements for ${selector}`);
    });

    // Убираем старые обработчики если есть
    if (this.clickHandler) {
      document.removeEventListener('click', this.clickHandler);
    }
    if (this.changeHandler) {
      document.removeEventListener('change', this.changeHandler);
    }

    // Единый обработчик кликов
    this.clickHandler = (event: Event) => {
      const target = event.target as Element;
      let matchedSelector: string | null = null;
      
      // Ищем первый подходящий селектор
      for (const selector of this.activeTriggerSelectors) {
        if (target.matches(selector) || target.closest(selector)) {
          matchedSelector = selector;
          break;
        }
      }
      
      if (matchedSelector) {
        console.log(`🎯 Navigation trigger activated: ${matchedSelector}`);
        
        // Для remelt фильтров даем больше времени на AJAX
        let delay = 500;
        if (matchedSelector === '.remelt__rank-item' || matchedSelector === '.remelt__lock-item') {
          delay = 1000;
        }
        
        setTimeout(() => {
          this.handleNavigationTrigger();
        }, delay);
      }
    };

    // Единый обработчик изменений для select элементов
    this.changeHandler = (event: Event) => {
      const target = event.target as Element;
      let matchedSelector: string | null = null;
      
      for (const selector of this.activeTriggerSelectors) {
        if ((selector.includes('select') || selector === '#choose_filter_page' || selector === '.category-type') &&
            (target.matches(selector) || target.closest(selector))) {
          matchedSelector = selector;
          break;
        }
      }
      
      if (matchedSelector) {
        console.log(`🎯 Select trigger activated: ${matchedSelector}`);
        const delay = matchedSelector === '.category-type' ? 1000 : 500;
        setTimeout(() => {
          this.handleNavigationTrigger();
        }, delay);
      }
    };

    document.addEventListener('click', this.clickHandler);
    document.addEventListener('change', this.changeHandler);

    console.log(`✅ Navigation triggers set up for ${triggerSelectors.length} selectors`);
  }

  private isNavigationProcessing: boolean = false;
  private navigationTimeout: number | null = null;
  private activeTriggerSelectors: string[] = [];
  private clickHandler: ((event: Event) => void) | null = null;
  private changeHandler: ((event: Event) => void) | null = null;
  
  private handleNavigationTrigger(): void {
    const timestamp = Date.now();
    console.log(`🔄 Navigation trigger called at ${timestamp}`);
    
    // Если уже идет обработка, ждем немного и повторяем
    if (this.isNavigationProcessing) {
      console.log(`🔄 Navigation trigger queued, waiting for current process to complete (started at ${this.lastNavigationStart})`);
      
      // Очередь на повторный вызов через небольшую задержку
      if (this.navigationTimeout) {
        clearTimeout(this.navigationTimeout);
      }
      
      this.navigationTimeout = window.setTimeout(() => {
        console.log('🔄 Retrying queued navigation trigger');
        this.handleNavigationTrigger();
      }, 300);
      
      return;
    }
    
    this.isNavigationProcessing = true;
    this.lastNavigationStart = timestamp;
    this.navigationCounter = (this.navigationCounter || 0) + 1;
    
    console.log(`🔄 Navigation trigger #${this.navigationCounter}: clearing state and regenerating stats`);
    
    // Автоматический сброс флага через максимальное время
    const maxProcessingTime = window.setTimeout(() => {
      console.log(`⏰ Navigation processing #${this.navigationCounter} timeout, resetting flag (was running for ${Date.now() - timestamp}ms)`);
      this.isNavigationProcessing = false;
    }, 5000);
    
    const resetFlag = () => {
      clearTimeout(maxProcessingTime);
      const duration = Date.now() - timestamp;
      console.log(`✅ Navigation processing #${this.navigationCounter} completed in ${duration}ms`);
      this.isNavigationProcessing = false;
    };
    
    const isRemeltPage = window.location.pathname.includes('/cards_remelt/');
    
    // Очищаем все флаги обработки
    console.log('🧹 Clearing all processed flags...');
    this.clearAllProcessedFlags();
    
    // Удаляем существующие overlay статистики
    console.log('🗑️ Removing all stats overlays...');
    this.removeAllStatsOverlays();
    
    // Для remelt страниц добавляем дополнительную очистку
    if (isRemeltPage) {
      console.log('🎯 Remelt page detected - performing deep cleanup...');
      
      // Очищаем защиту от дублирования
      this.processingIds.clear();
      
      // Очищаем флаги наблюдения используя ТОЧНО ТАКОЙ ЖЕ селектор как в processExistingCards
      const remeltImages = document.querySelectorAll('.remelt__inventory-item img[src*="/uploads/cards_image/"]');
      let totalImgsCleared = 0;
      
      console.log(`🔍 DEBUG: Found ${remeltImages.length} images with selector`);
      
      remeltImages.forEach((img, index) => {
        const hadProcessed = img.hasAttribute('data-animestars-processed');
        const hadObserving = img.hasAttribute('data-animestars-observing');
        
        if (index < 3) { // Логируем первые 3 элемента для отладки
          console.log(`🔍 DEBUG img[${index}]: processed=${hadProcessed}, observing=${hadObserving}, src=${(img as HTMLImageElement).src}`);
        }
        
        img.removeAttribute('data-animestars-processed');
        img.removeAttribute('data-animestars-observing');
        if (hadProcessed || hadObserving) {
          totalImgsCleared++;
        }
      });
      
      console.log(`🧹 Deep cleaned ${remeltImages.length} remelt cards, cleared flags from ${totalImgsCleared} images`);
      
      // Для remelt просто сбрасываем флаг - обработка уже идет в основном потоке
      resetFlag();
    } else {
      // Обычная обработка для других страниц (включая trade)
      setTimeout(() => {
        console.log(`⚡ Triggering card processing for navigation #${this.navigationCounter}...`);
        this.processExistingCardsDebounced();
        resetFlag();
      }, 100);
    }
  }

  private removeAllStatsOverlays(): void {
    const overlays = document.querySelectorAll('.card-stats-overlay');
    overlays.forEach(overlay => {
      overlay.remove();
    });
    console.log(`🗑️ Removed ${overlays.length} existing stats overlays`);
  }

  private forceProcessAllCards(): void {
    console.log('🚀 Force processing all cards...');
    
    // Принудительно обрабатываем все карты
    this.processExistingCards();
  }

  private async checkAndUpdateDatabase(): Promise<void> {
    // Content script больше НЕ ждет загрузку базы данных!
    // Он просто работает с тем что есть, а background загружает данные асинхронно
    console.log('🔍 Content script no longer waits for database, background handles it');
  }

  private startDOMObserver(): void {
    const observer = new MutationObserver((mutations) => {
      let shouldProcess = false;
      let isTradePageUpdate = false;
      let hasCardChanges = false;

      // Проверяем, что мы НЕ на каталоге карточек
      const isCardsCatalog = window.location.pathname === '/cards/' || 
                            window.location.pathname.startsWith('/cards/?');

      mutations.forEach((mutation) => {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          // Проверяем, добавились ли новые элементы с картами
          Array.from(mutation.addedNodes).forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node as Element;
              
              // КРИТИЧНО: Игнорируем ВСЕ изменения, связанные с нашей статистикой
              if (element.classList.contains('card-stats-overlay') || 
                  element.closest('.card-stats-overlay') ||
                  element.querySelector('.card-stats-overlay') ||
                  element.classList.contains('card-stats') ||
                  element.closest('.card-stats')) {
                return; // Полностью пропускаем наши изменения
              }
              
              // На каталоге карточек НЕ считаем изменения trade updates
              if (isCardsCatalog) {
                // На каталоге только проверяем новые карточки, но не как trade update
                if (this.isCardElement(element)) {
                  shouldProcess = true;
                  hasCardChanges = true;
                }
              } else {
                // На других страницах (реальных trade) - полная логика
                if (this.isTradePageContainer(element)) {
                  isTradePageUpdate = true;
                  shouldProcess = true;
                  hasCardChanges = true;
                } else if (this.isCardElement(element)) {
                  shouldProcess = true;
                  hasCardChanges = true;
                }
              }
              
              // Проверяем, есть ли карты внутри добавленного элемента
              if (this.hasCardsInside(element)) {
                shouldProcess = true;
                hasCardChanges = true;
                // Только на НЕ-каталоговых страницах считаем это trade update
                if (!isCardsCatalog && this.isTradeRelatedElement(element, null)) {
                  isTradePageUpdate = true;
                }
              }
            }
          });
        }
        
        // Отслеживаем удаление элементов для очистки флагов (только для значимых контейнеров)
        if (mutation.type === 'childList' && mutation.removedNodes.length > 0) {
          Array.from(mutation.removedNodes).forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node as Element;
              // Очищаем флаги только у больших контейнеров, не у отдельных карт
              if (this.hasCardsInside(element) && (element.children.length > 5 || element.classList.contains('trade__inventory'))) {
                this.clearProcessedFlags(element);
              }
            }
          });
        }
        
        // Также отслеживаем изменения атрибутов, которые могут указывать на обновление контента
        if (mutation.type === 'attributes' && mutation.target) {
          const element = mutation.target as Element;
          if (this.isTradeRelatedElement(element, mutation.attributeName)) {
            isTradePageUpdate = true;
            shouldProcess = true;
            hasCardChanges = true;
            
            // Сбрасываем флаг обработки для переобработки
            if (element.hasAttribute('data-animestars-processed')) {
              element.removeAttribute('data-animestars-processed');
            }
          }
        }
      });

      if (shouldProcess) {
        // Увеличиваем задержки для лучшей обработки динамического контента
        const delay = isTradePageUpdate ? 800 : 300; // Увеличены задержки для трейдов
        
        if (hasCardChanges) {
          console.log(`🔄 DOM changes detected, processing in ${delay}ms...`);
          if (isTradePageUpdate) {
            console.log('🔄 Trade page update detected, clearing processed flags...');
            // Очищаем все флаги обработки на трейд-страницах для переобработки
            this.clearAllProcessedFlags();
          }
        } 
        setTimeout(() => this.processExistingCardsDebounced(), delay);
      }
    });

    // Настройки observer с улучшенным мониторингом
    const observerConfig = {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'data-loaded', 'data-updated', 'style', 'data-pack-id', 'data-id'] // Расширенный список атрибутов
    };

    observer.observe(document.body, observerConfig);
    console.log('👀 DOM observer started with lootbox and trade page support');
    
    // Дополнительная проверка каждые 2 секунды для лутбоксов
    if (window.location.pathname.includes('/pack/')) {
      setInterval(() => {
        const lootboxCards = document.querySelectorAll('.lootbox__card[data-id]');
        if (lootboxCards.length > 0) {
          console.log(`🎰 Periodic lootbox check: found ${lootboxCards.length} cards`);
          this.processExistingCardsDebounced();
        }
      }, 2000);
    }
  }

  private hasCardsInside(element: Element): boolean {
    // Проверяем, есть ли карты внутри элемента
    return this.cardSelectors.some(selector => 
      element.querySelector(selector.selector)
    );
  }

  private clearProcessedFlags(container: Element): void {
    const processedElements = container.querySelectorAll('[data-animestars-processed]');
    processedElements.forEach(el => {
      el.removeAttribute('data-animestars-processed');
    });
    console.log(`🧹 Cleared ${processedElements.length} processed flags in container`);
  }

  private clearAllProcessedFlags(): void {
    // Очищаем все флаги обработки на странице для полной переобработки
    const allProcessedElements = document.querySelectorAll('[data-animestars-processed]');
    allProcessedElements.forEach(el => {
      el.removeAttribute('data-animestars-processed');
    });
    
    // Также очищаем флаги наблюдения
    const allObservingElements = document.querySelectorAll('[data-animestars-observing]');
    allObservingElements.forEach(el => {
      el.removeAttribute('data-animestars-observing');
    });
    
    // Очищаем кэши для полной переобработки
    this.pendingCards.clear();
    
    console.log(`🧹 Cleared ${allProcessedElements.length} processed flags and ${allObservingElements.length} observing flags for reprocessing`);
  }

  private isTradePageContainer(element: Element): boolean {
    // Проверяем URL - если это не trade страница, то это не trade container
    if (!window.location.pathname.includes('/trade/')) {
      return false;
    }

    // Проверяем, является ли это контейнером для трейд-карт (ТОЛЬКО для trade pages)
    const tradeContainerSelectors = [
      '.trade__inventory',
      '.trade__main', 
      '.trade__offers',
      '.trade__cards-list',
      '.trade-section',
      '[class*="trade-inventory"]',
      '[id*="trade"]'
    ];

    return tradeContainerSelectors.some(selector => 
      element.matches(selector) || element.querySelector(selector)
    );
  }

  private isCardElement(element: Element): boolean {
    // Проверяем, является ли элемент или его родители элементом карты
    let current: Element | null = element;
    let depth = 0;
    const maxDepth = 5; // Ограничиваем глубину поиска

    while (current && depth < maxDepth) {
      // Проверяем по селекторам карт
      for (const selector of this.cardSelectors) {
        if (current.matches && current.matches(selector.selector)) {
          return true;
        }
      }

      // Проверяем наличие характерных атрибутов карт
      if (current) {
        const cardAttributes = ['data-id', 'data-card-id', 'data-pack-id', 'data-rank'];
        if (cardAttributes.some(attr => current!.hasAttribute(attr))) {
          return true;
        }
      }

      // Проверяем классы элемента
      if (current && current.className && typeof current.className === 'string') {
        const cardClasses = ['card', 'trade-card', 'inventory-card', 'pack-card', 'owl-item'];
        if (cardClasses.some(cls => current!.className.includes(cls))) {
          return true;
        }
      }

      current = current.parentElement;
      depth++;
    }

    return false;
  }

  private isTradeRelatedElement(element: Element, attributeName: string | null): boolean {
    // Проверяем, связано ли изменение атрибута с функциональностью карт
    if (!attributeName) return false;

    // ВАЖНО: Игнорируем изменения, вызванные нашим расширением
    if (element.classList.contains('card-stats-overlay') || 
        element.closest('.card-stats-overlay') ||
        element.querySelector('.card-stats-overlay')) {
      return false; // НЕ обрабатываем наши собственные изменения
    }

    const cardRelatedAttributes = ['data-loaded', 'data-updated', 'src', 'data-id', 'data-rank'];

    // ТОЛЬКО для РЕАЛЬНЫХ trade страниц (не каталог карточек!)
    const isActualTradePage = window.location.pathname.match(/\/cards\/\d+\/trade\//) || 
                             window.location.pathname === '/trade/';
    
    if (!isActualTradePage) {
      return false; // Не trade страница - не обрабатываем как trade update
    }

    // Специальная обработка для трейд-страниц
    const tradeSpecificAttributes = ['data-id', 'data-rank', 'src', 'href', 'data-card-id'];
    if (tradeSpecificAttributes.includes(attributeName)) {
      // Проверяем, что это действительно карточка или trade контейнер
      return this.isCardElement(element) || this.isTradePageContainer(element);
    }

    // Проверяем изменение релевантных атрибутов
    if (cardRelatedAttributes.includes(attributeName)) {
      return this.isCardElement(element);
    }

    return false;
  }

  private getPageType(): string {
    const path = window.location.pathname;
    
    if (path.includes('/trade/')) {
      return 'trade';
    } else if (path.includes('/cards_remelt/')) {
      return 'remelt';
    } else if (path.includes('/cards/')) {
      return 'cards catalog';
    } else if (path.includes('/history/')) {
      return 'history';
    } else if (path.includes('/inventory/')) {
      return 'inventory';
    } else {
      return 'general';
    }
  }

  private async processExistingCards(): Promise<void> {
    if (!this.isInitialized || !this.intersectionObserver) {
      console.log('⚠️ processExistingCards: not initialized or no observer');
      return;
    }

    const isRemeltPage = window.location.pathname.includes('/cards_remelt/');
    console.log(`🔍 processExistingCards: Starting for ${isRemeltPage ? 'remelt' : 'other'} page`);

    let totalElements = 0;
    let addedToObserver = 0;

    // Находим все элементы карт и добавляем их в observer для ленивой загрузки
    for (const selector of this.cardSelectors) {
      const elements = document.querySelectorAll(selector.selector);
      totalElements += elements.length;
      
      if (elements.length > 0) {
        console.log(`🔍 Found ${elements.length} elements for selector: ${selector.selector}`);
      }
      
      elements.forEach(element => {
        const htmlElement = element as HTMLElement;
        
        // Для remelt страниц более агрессивная обработка
        if (isRemeltPage && selector.selector.includes('remelt__inventory-item')) {
          // Проверяем, есть ли overlay, игнорируя флаги
          const hasOverlay = htmlElement.querySelector('.card-stats-overlay');
          
          if (!hasOverlay) {
            // Сбрасываем флаги и добавляем в observer
            htmlElement.removeAttribute('data-animestars-observing');
            htmlElement.removeAttribute('data-animestars-processed');
            htmlElement.setAttribute('data-animestars-observing', 'true');
            this.intersectionObserver!.observe(htmlElement);
            addedToObserver++;
          }
        } else {
          // Обычная обработка для других страниц
          if (!htmlElement.hasAttribute('data-animestars-observing') && 
              !htmlElement.querySelector('.card-stats-overlay')) {
            
            htmlElement.setAttribute('data-animestars-observing', 'true');
            this.intersectionObserver!.observe(htmlElement);
            addedToObserver++;
          }
        }
      });
    }
    
    console.log(`🔍 processExistingCards: Found ${totalElements} total elements, added ${addedToObserver} to observer`);
  }

  private getCardDataFromElement(element: HTMLElement): CardElement | null {
    for (const selector of this.cardSelectors) {
      if (element.matches(selector.selector)) {
        const cardId = this.extractCardId(element, selector);
        const cardName = this.extractCardName(element, selector);
        
        if (cardId && !element.querySelector('.card-stats-overlay')) {
          return {
            element,
            cardId,
            cardName
          };
        }
        break;
      }
    }
    return null;
  }

  private debounce<T extends (...args: any[]) => any>(
    func: T,
    wait: number
  ): (...args: Parameters<T>) => void {
    let timeout: NodeJS.Timeout;
    return (...args: Parameters<T>) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  private async extractCardIdAsync(element: HTMLElement, selector: CardSelector): Promise<number | null> {
    const attr = selector.dataIdAttribute;
    
    // Извлечение из URL изображения - ищем в базе данных
    if (selector.extractFromImage && attr === 'src') {
      const img = element.tagName === 'IMG' ? element : element.querySelector('img');
      if (img) {
        const src = img.getAttribute('src');
        if (src) {
          // Сначала ищем карту по URL изображения в базе данных
          const cardId = await this.findCardIdByImageUrlAsync(src);
          if (cardId) {
            return cardId;
          }
          
          console.log(`⚠️ Card not found in DB for image: ${src}`);
          
          // ❌ НЕ ИСПОЛЬЗУЕМ FALLBACK для URL изображений!
          // Числа в URL - это ID аниме, а не карты
          console.log(`   Reason: Numbers in image URL are anime IDs, not card IDs`);
          console.log(`   This means either: 1) Card is new and not in DB yet, 2) Image URL changed`);
          return null; // Просто пропускаем карту без обработки
        }
      }
      return null;
    }

    // Синхронные случаи остаются без изменений
    return this.extractCardId(element, selector);
  }

  private extractCardId(element: HTMLElement, selector: CardSelector): number | null {
    const attr = selector.dataIdAttribute;
    
    // Для изображений используем асинхронный метод
    if (selector.extractFromImage && attr === 'src') {
      // Этот метод больше не обрабатывает изображения синхронно
      return null;
    }
    
    if (attr === 'href') {
      // Извлекаем ID из href типа "/cards/users/?id=12345"
      const href = element.getAttribute('href');
      if (href) {
        const match = href.match(/id=(\d+)/);
        return match ? parseInt(match[1], 10) : null;
      }
    } else {
      // Для anime-cards__item-wrapper ищем data-id в дочернем элементе
      let targetElement = element;
      if (element.classList.contains('anime-cards__item-wrapper')) {
        const cardItem = element.querySelector('.anime-cards__item');
        if (cardItem) {
          targetElement = cardItem as HTMLElement;
        }
      }
      
      // Извлекаем из data-атрибута
      const value = targetElement.getAttribute(attr);
      return value ? parseInt(value, 10) : null;
    }
    
    return null;
  }

  private findCardIdByImageUrl(imageUrl: string): number | null {
    // Синхронный поиск не возможен, вернем null и используем асинхронный подход
    return null;
  }

  private async findCardIdByImageUrlAsync(imageUrl: string): Promise<number | null> {
    try {
      // Нормализуем URL - убираем домен и ведущий слеш
      const normalizedUrl = imageUrl.replace(/^https?:\/\/[^\/]+/, '').replace(/^\/+/, '');
      
      // Проверяем кэш
      if (this.cardIdCache.has(normalizedUrl)) {
        return this.cardIdCache.get(normalizedUrl)!;
      }
      
      // Запрашиваем поиск карты по изображению через background script
      const response = await chrome.runtime.sendMessage({
        type: 'findCardByImage',
        data: { imageUrl: normalizedUrl }
      });
      
      if (response.success && response.cardId) {
        // Кэшируем результат
        this.cardIdCache.set(normalizedUrl, response.cardId);
        return response.cardId;
      }
      
      // Карта не найдена по изображению
      return null;
    } catch (error) {
      console.error('Error finding card by image:', error);
      return null;
    }
  }

  private extractCardName(element: HTMLElement, selector: CardSelector): string | undefined {
    if (selector.dataNameAttribute) {
      // Для anime-cards__item-wrapper ищем data-name в дочернем элементе
      let targetElement = element;
      if (element.classList.contains('anime-cards__item-wrapper')) {
        const cardItem = element.querySelector('.anime-cards__item');
        if (cardItem) {
          targetElement = cardItem as HTMLElement;
        }
      }
      
      return targetElement.getAttribute(selector.dataNameAttribute) || undefined;
    }
    return undefined;
  }

  private async addStatsOverlay(card: CardElement): Promise<void> {
    try {
      // Проверяем ограничения ресурсов (кроме страниц трейдов и ремелт)
      const isUnlimited = this.isUnlimitedPage();
      if (!isUnlimited && this.currentOverlaysCount >= this.MAX_TOTAL_OVERLAYS) {
        return;
      }
      
      // Лог для страниц без лимита
      if (isUnlimited && this.currentOverlaysCount === this.MAX_TOTAL_OVERLAYS) {
        console.log(`🚀 Unlimited mode: No overlay limit on trade/remelt pages (current: ${this.currentOverlaysCount})`);
      }

      // Проверяем, что элемент все еще в DOM
      if (!document.contains(card.element)) {
        return;
      }

      // Усиленная проверка для remelt страниц
      const isRemeltPage = window.location.pathname.includes('/cards_remelt/');
      if (isRemeltPage) {
        // Для remelt создаём уникальный идентификатор на основе изображения
        const imgElement = card.element.querySelector('img') as HTMLImageElement;
        if (imgElement && imgElement.src) {
          const imageId = imgElement.src.split('/').pop() || '';
          const processingKey = `remelt-${imageId}`;
          
          // Проверяем глобальную защиту от дублирования
          if (this.processingIds.has(processingKey)) {
            console.log(`🚫 Remelt duplicate protection: ${processingKey} already processing`);
            return;
          }
          
          // Устанавливаем защиту
          this.processingIds.add(processingKey);
          
          // Очищаем защиту через 5 секунд
          setTimeout(() => {
            this.processingIds.delete(processingKey);
          }, 5000);
        }
      }

      // Проверяем, есть ли уже статистика на этой карточке
      const existingOverlay = card.element.querySelector('.card-stats-overlay');
      const hasProcessedFlag = card.element.hasAttribute('data-animestars-processed');
      if (existingOverlay || hasProcessedFlag) {
        console.log(`⚠️ Overlay already exists or card already processed, skipping...`);
        console.log(`   - Existing overlay: ${!!existingOverlay}`);
        console.log(`   - Has processed flag: ${hasProcessedFlag}`);
        console.log(`   - Element tag: ${card.element.tagName}`);
        console.log(`   - Element src: ${(card.element as any).src || 'no src'}`);
        return;
      }

      // Двойная проверка для защиты от race condition
      const allOverlays = card.element.querySelectorAll('.card-stats-overlay');
      if (allOverlays.length > 0) {
        console.warn(`🔄 Found ${allOverlays.length} existing overlays, removing duplicates...`);
        allOverlays.forEach(overlay => overlay.remove());
      }

      // Устанавливаем флаг обработки перед запросом
      card.element.setAttribute('data-animestars-processed', 'true');

      let stats;
      
      // Проверяем кэш статистики
      if (this.statsCache.has(card.cardId)) {
        stats = this.statsCache.get(card.cardId);
      } else {
        // Запрашиваем статистику карты через background script
        const response = await chrome.runtime.sendMessage({
          type: 'getCardStats',
          data: { cardId: card.cardId }
        });
        
        if (!response.success || !response.data) {
          return;
        }
        
        stats = response.data;
        // Кэшируем статистику
        this.statsCache.set(card.cardId, stats);
      }

      const overlay = this.createStatsOverlay(stats, card.cardId, card.element, card.cardName);
      
      // Находим подходящий селектор для этого элемента
      const matchingSelector = this.cardSelectors.find(selector => 
        card.element.matches(selector.selector)
      );

      if (matchingSelector) {
        this.insertOverlay(card.element, overlay, matchingSelector);
        this.currentOverlaysCount++;
      }

    } catch (error) {
      console.error(`❌ Error adding overlay for card ${card.cardId}:`, error);
    }
  }

  private createStatsOverlay(stats: { users: number; need: number; trade: number }, cardId: number, cardElement: HTMLElement, cardName?: string): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'card-stats-overlay';
    
    const statsContainer = document.createElement('div');
    statsContainer.className = 'card-stats';
    
    // Создаем элементы статистики
    const usersSpan = document.createElement('span');
    usersSpan.innerHTML = `<i class="fas fa-users"></i> ${stats.users || 0}`;
    usersSpan.title = 'Владельцев';
    usersSpan.setAttribute('data-card-id', cardId.toString());
    usersSpan.style.cursor = 'pointer';
    usersSpan.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.open(`https://animestars.org/cards/users/?id=${cardId}`, '_blank');
    });
    
    const needSpan = document.createElement('span');
    needSpan.innerHTML = `<i class="fas fa-heart"></i> ${stats.need || 0}`;
    needSpan.title = 'Хотят получить';
    needSpan.setAttribute('data-card-id', cardId.toString());
    needSpan.style.cursor = 'pointer';
    needSpan.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.open(`https://animestars.org/cards/users/need/?id=${cardId}`, '_blank');
    });
    
    const tradeSpan = document.createElement('span');
    tradeSpan.innerHTML = `<i class="fas fa-sync-alt"></i> ${stats.trade || 0}`;
    tradeSpan.title = 'Готовы обменять';
    tradeSpan.setAttribute('data-card-id', cardId.toString());
    tradeSpan.style.cursor = 'pointer';
    tradeSpan.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.open(`https://animestars.org/cards/users/trade/?id=${cardId}`, '_blank');
    });
    
    statsContainer.appendChild(usersSpan);
    statsContainer.appendChild(needSpan);
    statsContainer.appendChild(tradeSpan);
    overlay.appendChild(statsContainer);

    // Предварительно устанавливаем layout для известных типов карточек
    const parentCard = cardElement.closest('.lootbox__card, .owl-item, .trade__inventory-item');
    const isLootboxCard = parentCard?.classList.contains('lootbox__card');
    const isOwlCard = parentCard?.closest('.owl-carousel');
    
    if (isLootboxCard) {
      // Для лутбоксов по умолчанию используем mixed layout
      statsContainer.setAttribute('data-layout', 'mixed');
    } else if (isOwlCard) {
      // Для owl-carousel используем mixed layout
      statsContainer.setAttribute('data-layout', 'mixed');
    } else {
      // Для остальных - horizontal
      statsContainer.setAttribute('data-layout', 'horizontal');
    }

    // Определяем точный лейаут на основе доступного места
    this.setLayoutForStats(overlay);

    // Добавляем обработчики клика
    this.addClickHandlers(overlay, cardId);

    return overlay;
  }

  private setLayoutForStats(overlay: HTMLElement): void {
    const statsContainer = overlay.querySelector('.card-stats') as HTMLElement;
    if (!statsContainer) return;

    // Получаем родительский элемент карточки для определения контекста
    const parentCard = overlay.closest('.lootbox__card, .owl-item, .trade__inventory-item');
    const isLootboxCard = parentCard?.classList.contains('lootbox__card');
    const isOwlCard = parentCard?.closest('.owl-carousel');

    // Функция для определения layout на основе ширины и типа карточки
    const updateLayout = (width: number) => {
      let layout = 'horizontal';
      
      // Для карточек лутбокса используем более агрессивные пороги
      if (isLootboxCard) {
        if (width < 120) {
          layout = 'vertical';
        } else {
          // Для лутбоксов почти всегда используем mixed layout
          layout = 'mixed';
        }
      } else if (isOwlCard) {
        // Для owl-carousel карточек
        if (width < 140) {
          layout = 'vertical';
        } else if (width < 190) {
          layout = 'mixed';
        }
      } else {
        // Стандартные пороги для обычных карточек
        if (width < 120) {
          layout = 'vertical';
        } else if (width < 180) {
          layout = 'mixed';
        }
      }
      
      statsContainer.setAttribute('data-layout', layout);
      // Логируем только изменения лейаута, не каждое обновление
      if (statsContainer.getAttribute('data-prev-layout') !== layout) {
        console.log(`📏 Layout changed to '${layout}' for width ${width}px (${isLootboxCard ? 'lootbox' : isOwlCard ? 'owl' : 'regular'} card)`);
        statsContainer.setAttribute('data-prev-layout', layout);
      }
    };

    // Используем ResizeObserver для динамического определения лейаута
    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        updateLayout(width);
      }
    });
    
    resizeObserver.observe(overlay);
    
    // Устанавливаем начальный лейаут сразу и с повторными попытками
    const setInitialLayout = () => {
      const width = overlay.offsetWidth;
      if (width > 0) {
        updateLayout(width);
      } else {
        // Если элемент еще не имеет размера, повторяем через короткое время
        setTimeout(setInitialLayout, 50);
      }
    };
    
    // Пробуем установить layout немедленно
    setInitialLayout();
  }

  private addClickHandlers(overlay: HTMLElement, cardId: number): void {
    const statItems = overlay.querySelectorAll('.card-stat-item');
    
    statItems.forEach((item) => {
      const element = item as HTMLElement;
      const type = element.getAttribute('data-type');
      
      element.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        
        let url = '';
        switch(type) {
          case 'users':
            url = `/cards/users/?id=${cardId}`;
            break;
          case 'need':
            url = `/cards/users/need/?id=${cardId}`;
            break;
          case 'trade':
            url = `/cards/users/trade/?id=${cardId}`;
            break;
          default:
            return;
        }
        
        console.log(`🔗 Navigating to: ${url}`);
        window.open(url, '_blank');
      });
      
      // Добавляем стили для hover эффекта
      element.style.cursor = 'pointer';
    });
  }

  private insertOverlay(cardElement: HTMLElement, overlay: HTMLElement, selector: CardSelector): void {
    // Финальная проверка на существование overlay перед вставкой
    const existingOverlays = cardElement.querySelectorAll('.card-stats-overlay');
    if (existingOverlays.length > 0) {
      console.warn(`🚫 Preventing duplicate overlay insertion: found ${existingOverlays.length} existing overlays`);
      overlay.remove(); // Удаляем созданный overlay
      return;
    }

    let targetElement: HTMLElement;
    
    if (selector.targetSelector) {
      // Если targetSelector указан, ищем его в DOM от cardElement вверх
      targetElement = cardElement.closest(selector.targetSelector) as HTMLElement;
      if (!targetElement) {
        // Если не найден через closest, пробуем найти через querySelector
        targetElement = cardElement.querySelector(selector.targetSelector) as HTMLElement || cardElement;
      }
    } else {
      targetElement = cardElement;
    }

    switch (selector.insertionMethod) {
      case 'append':
        targetElement.appendChild(overlay);
        break;
      case 'prepend':
        targetElement.insertBefore(overlay, targetElement.firstChild);
        break;
      case 'before':
        targetElement.parentNode?.insertBefore(overlay, targetElement);
        break;
      case 'after':
        targetElement.parentNode?.insertBefore(overlay, targetElement.nextSibling);
        break;
    }
  }

  private showUpdateNotification(message: string, type: 'success' | 'error' = 'success'): void {
    // Создаем уведомление в правом верхнем углу
    const notification = document.createElement('div');
    notification.className = `animestars-notification animestars-notification--${type}`;
    notification.textContent = message;
    
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${type === 'success' ? '#4CAF50' : '#f44336'};
      color: white;
      padding: 12px 16px;
      border-radius: 4px;
      z-index: 10000;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 14px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      max-width: 300px;
    `;

    document.body.appendChild(notification);

    // Удаляем уведомление через 5 секунд
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 5000);
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = window.setInterval(() => {
      this.performCleanup();
    }, this.CLEANUP_INTERVAL);
  }

  private performCleanup(): void {
    console.log('🧹 Performing memory cleanup...');
    
    // Очищаем невидимые или удаленные оверлеи
    const overlays = document.querySelectorAll('.card-stats-overlay');
    let removed = 0;
    
    overlays.forEach(overlay => {
      const parent = overlay.parentElement;
      
      // Удаляем оверлеи без родителя или невидимые
      if (!parent || !document.body.contains(parent)) {
        overlay.remove();
        removed++;
        this.currentOverlaysCount--;
      }
    });
    
    // Очищаем удаленные элементы из обработки (очередей больше нет)
    if (removed > 0) {
      console.log(`🧹 Cleanup completed: ${removed} overlays removed`);
    }
    
    // Ограничиваем общее количество оверлеев (кроме страниц трейдов и ремелт)
    if (!this.isUnlimitedPage() && this.currentOverlaysCount > this.MAX_TOTAL_OVERLAYS) {
      const excessOverlays = document.querySelectorAll('.card-stats-overlay');
      const toRemove = this.currentOverlaysCount - this.MAX_TOTAL_OVERLAYS;
      
      for (let i = 0; i < toRemove && i < excessOverlays.length; i++) {
        excessOverlays[i].remove();
        this.currentOverlaysCount--;
      }
      
      console.log(`🧹 Removed ${toRemove} excess overlays to stay within limit`);
    }
  }

  // Метод для полной очистки ресурсов
  destroy(): void {
    console.log('🔥 Destroying CardStatsOverlay...');
    
    // Очищаем таймеры
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    
    if (this.userInactivityTimer) {
      clearTimeout(this.userInactivityTimer);
      this.userInactivityTimer = null;
    }
    
    if (this.navigationTimeout) {
      clearTimeout(this.navigationTimeout);
      this.navigationTimeout = null;
    }
    
    // Очищаем обработчики событий
    if (this.clickHandler) {
      document.removeEventListener('click', this.clickHandler);
      this.clickHandler = null;
    }
    
    if (this.changeHandler) {
      document.removeEventListener('change', this.changeHandler);
      this.changeHandler = null;
    }
    
    // Отключаем IntersectionObserver
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = null;
    }
    
    // Очищаем кэши
    this.cardIdCache.clear();
    this.statsCache.clear();
    this.pendingCards.clear();
    
    // Удаляем все overlay
    this.removeAllStatsOverlays();
    
    console.log('🔥 CardStatsOverlay destroyed');
  }
}

// Инициализация при загрузке страницы
const cardStatsOverlay = new CardStatsOverlay();

// Запускаем инициализацию когда DOM готов
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => cardStatsOverlay.init());
} else {
  cardStatsOverlay.init();
}

// Очистка при выгрузке страницы
window.addEventListener('beforeunload', () => {
  cardStatsOverlay.destroy();
});

// Экспортируем для отладки
(window as any).cardStatsOverlay = cardStatsOverlay;
