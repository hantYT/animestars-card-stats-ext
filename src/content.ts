import { GitHubService } from './github';
import { CardElement, CardSelector } from './types';
import './content.css';

class CardStatsOverlay {
  private githubService: GitHubService;
  private isInitialized = false;

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
      selector: '.trade__inventory-item',
      dataIdAttribute: 'data-card-id',
      insertionMethod: 'append'
    },
    {
      selector: '.trade__main-item',
      dataIdAttribute: 'href',
      insertionMethod: 'append'
    },
    {
      selector: '.trade__item', // Дополнительный селектор для трейдов
      dataIdAttribute: 'data-card-id',
      insertionMethod: 'append'
    },
    {
      selector: '.trade-card', // Еще один возможный селектор
      dataIdAttribute: 'data-id',
      insertionMethod: 'append'
    },
    {
      selector: '.inventory-card', // Для карт в инвентаре
      dataIdAttribute: 'data-card-id',
      insertionMethod: 'append'
    },
    {
      selector: '.history__body-item',
      dataIdAttribute: 'href',
      insertionMethod: 'append'
    }
  ];

  constructor() {
    this.githubService = new GitHubService();
  }

  async init(): Promise<void> {
    if (this.isInitialized) return;

    try {
      console.log('🚀 Initializing AnimestarsCards Stats Extension...');
      
      // Не нужно инициализировать локальную базу, используем background
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

      // Слушаем обновления базы данных от background
      this.setupMessageListener();

      // Запускаем мониторинг изменений DOM
      this.startDOMObserver();
      
      // Обрабатываем уже существующие карты
      this.processExistingCards();

    } catch (error) {
      console.error('❌ Error initializing extension:', error);
    }
  }

  private setupMessageListener(): void {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'databaseUpdated') {
        console.log(`🔄 Database updated: ${message.data.cardsCount} cards`);
        // Перерисовываем все карты с новыми данными
        this.processExistingCards();
      }
    });
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

      mutations.forEach((mutation) => {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          // Проверяем, добавились ли новые элементы с картами
          Array.from(mutation.addedNodes).forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node as Element;
              
              // Особое внимание к контейнерам на страницах трейдов
              if (this.isTradePageContainer(element)) {
                isTradePageUpdate = true;
                shouldProcess = true;
              } else if (this.isCardElement(element)) {
                shouldProcess = true;
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
          }
        }
      });

      if (shouldProcess) {
        const delay = isTradePageUpdate ? 300 : 100; // Больше времени для трейд-страниц
        setTimeout(() => this.processExistingCards(), delay);
      }
    });

    // Настройки observer с учетом трейд-страниц
    const observerConfig = {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'data-loaded', 'data-updated', 'style'] // Атрибуты, которые часто меняются при AJAX загрузке
    };

    observer.observe(document.body, observerConfig);
    console.log('👀 DOM observer started with trade page support');
  }

  private isCardElement(element: Element): boolean {
    return this.cardSelectors.some(selector => 
      element.matches(selector.selector) || element.querySelector(selector.selector)
    );
  }

  private isTradePageContainer(element: Element): boolean {
    // Проверяем, является ли это контейнером для трейд-карт
    const tradeContainerSelectors = [
      '.trade__inventory',
      '.trade__main',
      '.trade__offers',
      '.trade__cards-list',
      '.trade-section',
      '[class*="trade"]',
      '[id*="trade"]'
    ];

    return tradeContainerSelectors.some(selector => 
      element.matches(selector) || element.querySelector(selector)
    );
  }

  private isTradeRelatedElement(element: Element, attributeName: string | null): boolean {
    // Проверяем, связано ли изменение атрибута с трейд-функциональностью
    if (!attributeName) return false;

    const tradeRelatedClasses = ['trade', 'card', 'inventory', 'loaded', 'updated'];
    const tradeRelatedAttributes = ['class', 'data-loaded', 'data-updated', 'style'];

    // Проверяем URL страницы
    const isTradePageUrl = window.location.pathname.includes('/trade/');
    
    if (!isTradePageUrl) return false;

    // Проверяем изменение релевантных атрибутов
    if (tradeRelatedAttributes.includes(attributeName)) {
      // Проверяем, содержит ли элемент трейд-связанные классы или карты
      const elementText = element.className + ' ' + element.tagName;
      return tradeRelatedClasses.some(keyword => 
        elementText.toLowerCase().includes(keyword.toLowerCase())
      ) || this.isCardElement(element);
    }

    return false;
  }

  private getPageType(): string {
    const path = window.location.pathname;
    
    if (path.includes('/trade/')) {
      return 'trade';
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
    if (!this.isInitialized) return;

    const isTradePageUrl = window.location.pathname.includes('/trade/');
    
    if (isTradePageUrl) {
      console.log('🔄 Processing cards on trade page...');
    }

    const allCards = this.findAllCards();
    console.log(`🎴 Found ${allCards.length} cards to process`);

    if (isTradePageUrl && allCards.length > 0) {
      console.log('📊 Trade page cards breakdown:');
      const cardsBySelector: { [key: string]: number } = {};
      
      this.cardSelectors.forEach(selector => {
        const elements = document.querySelectorAll(selector.selector);
        if (elements.length > 0) {
          cardsBySelector[selector.selector] = elements.length;
        }
      });
      
      console.table(cardsBySelector);
    }

    for (const card of allCards) {
      await this.addStatsOverlay(card);
    }
  }

  private findAllCards(): CardElement[] {
    const cards: CardElement[] = [];

    this.cardSelectors.forEach(selector => {
      const elements = document.querySelectorAll(selector.selector);
      
      elements.forEach(element => {
        const cardId = this.extractCardId(element as HTMLElement, selector);
        const cardName = this.extractCardName(element as HTMLElement, selector);
        
        if (cardId) {
          // Проверяем, что оверлей еще не добавлен
          if (!element.querySelector('.card-stats-overlay')) {
            cards.push({
              element: element as HTMLElement,
              cardId,
              cardName
            });
          }
        }
      });
    });

    return cards;
  }

  private extractCardId(element: HTMLElement, selector: CardSelector): number | null {
    const attr = selector.dataIdAttribute;
    
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
      // Запрашиваем статистику карты через background script
      const response = await chrome.runtime.sendMessage({
        type: 'getCardStats',
        data: { cardId: card.cardId }
      });
      
      if (!response.success || !response.data) {
        console.log(`📭 No stats found for card ${card.cardId}`);
        return;
      }
      
      const stats = response.data;

      const overlay = this.createStatsOverlay(stats, card.cardId, card.cardName);
      
      // Находим подходящий селектор для этого элемента
      const matchingSelector = this.cardSelectors.find(selector => 
        card.element.matches(selector.selector)
      );

      if (matchingSelector) {
        this.insertOverlay(card.element, overlay, matchingSelector);
      }

    } catch (error) {
      console.error(`❌ Error adding overlay for card ${card.cardId}:`, error);
    }
  }

  private createStatsOverlay(stats: { users: number; need: number; trade: number }, cardId: number, cardName?: string): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'card-stats-overlay';
    
    // Определяем высокие значения
    const isHighUsers = stats.users >= 50;
    const isHighNeed = stats.need >= 30;
    const isHighTrade = stats.trade >= 10;
    
    // Считаем общую длину всех цифр для адаптации размера
    const totalDigits = String(stats.users).length + String(stats.need).length + String(stats.trade).length;
    const maxValue = Math.max(stats.users, stats.need, stats.trade);
    
    overlay.innerHTML = `
      <div class="card-stats">
        <span class="card-stat-item" data-type="users" data-card-id="${cardId}" title="Владельцев" ${isHighUsers ? 'data-high-value="true"' : ''}><i class="fas fa-users"></i> ${stats.users || 0}</span>
        <span class="card-stat-item" data-type="need" data-card-id="${cardId}" title="Хотят получить" ${isHighNeed ? 'data-high-value="true"' : ''}><i class="fas fa-heart"></i> ${stats.need || 0}</span>
        <span class="card-stat-item" data-type="trade" data-card-id="${cardId}" title="Готовы обменять" ${isHighTrade ? 'data-high-value="true"' : ''}><i class="fas fa-sync-alt"></i> ${stats.trade || 0}</span>
      </div>
    `;

    // Применяем адаптивные размеры
    this.applyAdaptiveStyles(overlay, totalDigits, maxValue);

    // Добавляем обработчики клика
    this.addClickHandlers(overlay, cardId);

    return overlay;
  }

  private applyAdaptiveStyles(overlay: HTMLElement, totalDigits: number, maxValue: number): void {
    const statsContainer = overlay.querySelector('.card-stats') as HTMLElement;
    if (!statsContainer) return;

    // Определяем размер на основе количества цифр и максимального значения
    let sizeClass = 'card-stats--medium'; // по умолчанию
    let gap = 5; // по умолчанию

    if (totalDigits <= 6 && maxValue < 100) {
      // Маленькие числа - большие отступы между блоками
      sizeClass = 'card-stats--large';
      gap = 8;
    } else if (totalDigits <= 9 && maxValue < 1000) {
      // Средние числа - средние отступы
      sizeClass = 'card-stats--medium';
      gap = 5;
    } else if (totalDigits <= 12 && maxValue < 10000) {
      // Большие числа - маленькие отступы
      sizeClass = 'card-stats--small';
      gap = 3;
    } else {
      // Очень большие числа - минимальные отступы
      sizeClass = 'card-stats--compact';
      gap = 2;
    }

    // Дополнительная адаптация на основе конкретных значений
    if (maxValue >= 1000) {
      // Для 4-значных чисел уменьшаем отступ
      gap = Math.max(gap - 1, 2);
    }
    
    if (maxValue >= 10000) {
      // Для 5+ значных чисел делаем минимальный отступ
      gap = 2;
    }

    // Минимальный отступ 2 пикселя, максимальный 10
    gap = Math.max(2, Math.min(gap, 10));

    // Применяем класс размера
    statsContainer.className = `card-stats ${sizeClass}`;
    
    // Устанавливаем динамический отступ между блоками
    statsContainer.style.setProperty('--stats-gap', `${gap}px`);

    // Дополнительная адаптация для очень длинных чисел
    if (maxValue >= 10000) {
      // Уменьшаем отступы еще больше для очень больших чисел
      const dynamicGap = Math.max(2, 6 - Math.floor(String(maxValue).length / 2));
      statsContainer.style.setProperty('--stats-gap', `${dynamicGap}px`);
      
      // Уменьшаем размер шрифта для очень больших чисел
      if (maxValue >= 100000) {
        statsContainer.style.setProperty('--stats-font-size', '7px');
      }
    }
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
    const targetElement = selector.targetSelector 
      ? cardElement.querySelector(selector.targetSelector) || cardElement
      : cardElement;

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
}

// Инициализация при загрузке страницы
const cardStatsOverlay = new CardStatsOverlay();

// Запускаем инициализацию когда DOM готов
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => cardStatsOverlay.init());
} else {
  cardStatsOverlay.init();
}

// Экспортируем для отладки
(window as any).cardStatsOverlay = cardStatsOverlay;
