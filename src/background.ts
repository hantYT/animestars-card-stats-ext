import { GitHubService } from './github';
import { DatabaseService } from './database';

// Background service worker для обновления данных
class BackgroundService {
  private githubService: GitHubService;
  private dbService: DatabaseService;
  private lastGitHubCheck: number = 0; // Время последней проверки GitHub в timestamp
  private readonly GITHUB_CHECK_INTERVAL = 2 * 60 * 60 * 1000; // 2 часа в миллисекундах

  constructor() {
    this.githubService = new GitHubService();
    this.dbService = new DatabaseService();
  }

  async init(): Promise<void> {
    console.log('🔧 Background service worker started');
    
    try {
      // Инициализируем базу данных
      console.log('📱 Initializing database service...');
      await this.dbService.init();
      console.log('✅ Database service initialized');
      
      // Быстро проверяем локальную базу
      console.log('🔍 Quick local database check...');
      const localInfo = await this.dbService.getDatabaseInfo();
      const cardsCount = await this.dbService.getCardsCount();
      
      if (localInfo && cardsCount > 0) {
        console.log(`✅ Local database ready: ${cardsCount} cards (${localInfo.filename})`);
        
        // База есть, проверяем нужно ли обновление с GitHub
        await this.checkGitHubIfNeeded();
      } else {
        console.log('📥 No local database, forcing GitHub check...');
        // Нет локальной базы, принудительно проверяем GitHub
        await this.forceGitHubCheck();
      }
      
      // Устанавливаем периодическую проверку обновлений
      this.schedulePeriodicUpdates();
      
      // Слушаем сообщения от content script и popup
      this.setupMessageHandlers();
      
      console.log('✅ Background service fully initialized');
    } catch (error) {
      console.error('❌ Error initializing background service:', error);
    }
  }

  private schedulePeriodicUpdates(): void {
    // Проверяем обновления каждые 2 часа
    const UPDATE_INTERVAL = 2 * 60 * 60 * 1000; // 2 hours in milliseconds
    
    setInterval(async () => {
      try {
        console.log('⏰ Scheduled database update check');
        await this.checkGitHubIfNeeded();
      } catch (error) {
        console.error('❌ Scheduled update failed:', error);
      }
    }, UPDATE_INTERVAL);
  }

  private async checkGitHubIfNeeded(): Promise<void> {
    const now = Date.now();
    
    // Проверяем, прошло ли достаточно времени с последней проверки
    if (now - this.lastGitHubCheck < this.GITHUB_CHECK_INTERVAL) {
      const timeLeft = Math.round((this.GITHUB_CHECK_INTERVAL - (now - this.lastGitHubCheck)) / 1000 / 60);
      console.log(`⏭️ GitHub check skipped, next check in ${timeLeft} minutes`);
      return;
    }

    console.log('🔍 Time for GitHub check...');
    this.lastGitHubCheck = now;
    
    try {
      const currentInfo = await this.dbService.getDatabaseInfo();
      const needsUpdate = await this.githubService.checkForUpdates(currentInfo);

      if (needsUpdate) {
        console.log('📥 Background update: Database outdated, updating...');
        const result = await this.githubService.updateDatabase();
        
        if (result.success) {
          console.log(`✅ Background update: Database updated with ${result.cardsCount} cards`);
          
          // Уведомляем все активные tabs
          this.notifyTabs('databaseUpdated', {
            cardsCount: result.cardsCount,
            message: `База данных обновлена: ${result.cardsCount} карт`
          });
        } else {
          console.error('❌ Background update failed:', result.error);
        }
      } else {
        console.log(`✅ GitHub check: Database is up to date`);
      }
    } catch (error) {
      console.error('❌ GitHub check failed:', error);
    }
  }

  private async forceGitHubCheck(): Promise<void> {
    console.log('🔄 Forcing GitHub check (no local database)...');
    this.lastGitHubCheck = Date.now();
    
    try {
      const result = await this.githubService.updateDatabase();
      
      if (result.success) {
        console.log(`✅ Forced update: Database loaded with ${result.cardsCount} cards`);
        
        // Уведомляем все активные tabs
        this.notifyTabs('databaseUpdated', {
          cardsCount: result.cardsCount,
          message: `База данных загружена: ${result.cardsCount} карт`
        });
      } else {
        console.error('❌ Forced update failed:', result.error);
      }
    } catch (error) {
      console.error('❌ Forced GitHub check failed:', error);
    }
  }

  private async checkAndUpdateDatabase(): Promise<void> {
    try {
      console.log('🔄 Checking database status...');
      
      const currentInfo = await this.dbService.getDatabaseInfo();
      const cardsCount = await this.dbService.getCardsCount();
      
      console.log(`📊 Current database info:`, { 
        hasInfo: !!currentInfo, 
        cardsCount, 
        filename: currentInfo?.filename 
      });
      
      // Если нет данных в базе - обязательно обновляем
      if (!currentInfo || cardsCount === 0) {
        console.log('📥 Background update: No data in database, loading...');
        const result = await this.githubService.updateDatabase();
        
        if (result.success) {
          console.log(`✅ Background update: Database loaded with ${result.cardsCount} cards`);
          
          // Уведомляем все активные tabs
          this.notifyTabs('databaseUpdated', {
            cardsCount: result.cardsCount,
            message: `База данных загружена: ${result.cardsCount} карт`
          });
        } else {
          console.error('❌ Background update failed:', result.error);
        }
        return;
      }
      
      // Если данные есть, проверяем обновления
      const needsUpdate = await this.githubService.checkForUpdates(currentInfo);

      if (needsUpdate) {
        console.log('📥 Background update: Database outdated, updating...');
        const result = await this.githubService.updateDatabase();
        
        if (result.success) {
          console.log(`✅ Background update: Database updated with ${result.cardsCount} cards`);
          
          // Уведомляем все активные tabs
          this.notifyTabs('databaseUpdated', {
            cardsCount: result.cardsCount,
            message: `База данных обновлена: ${result.cardsCount} карт`
          });
        } else {
          console.error('❌ Background update failed:', result.error);
        }
      } else {
        console.log(`✅ Background check: Database is up to date (${cardsCount} cards)`);
      }
    } catch (error) {
      console.error('❌ Background database check failed:', error);
    }
  }

  private setupMessageHandlers(): void {
    chrome.runtime.onMessage.addListener((message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
      this.handleMessage(message, sender, sendResponse);
      return true; // Indicates we will send a response asynchronously
    });
  }

  private async handleMessage(message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void): Promise<void> {
    try {
      console.log('📨 Background received message:', message.type, message.data);
      
      switch (message.type) {
        case 'getDatabasesList':
          console.log('🔄 Get databases list requested');
          try {
            const response = await fetch(message.data.apiUrl, {
              headers: {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'AnimestarsCards-Extension'
              }
            });
            
            if (!response.ok) {
              if (response.status === 404) {
                console.log('Databases folder not found');
                sendResponse({ success: true, data: [] });
                break;
              }
              throw new Error(`GitHub API error! status: ${response.status}`);
            }
            
            const files = await response.json();
            
            // Фильтруем только JSON файлы с нашим паттерном
            const dbFiles = files.filter((file: any) => 
              file.name.startsWith('animestars_') && 
              file.name.endsWith('.json') &&
              file.type === 'file'
            );
            
            console.log(`✅ Found ${dbFiles.length} database files`);
            sendResponse({ success: true, data: dbFiles });
          } catch (error) {
            console.error('❌ Get databases list failed:', error);
            sendResponse({ success: false, error: error instanceof Error ? error.message : 'Failed to get databases list' });
          }
          break;

        case 'downloadDatabase':
          console.log('🔄 Download database requested');
          try {
            const response = await fetch(message.data.url, {
              headers: {
                'Accept': 'application/json',
                'User-Agent': 'AnimestarsCards-Extension'
              }
            });
            
            if (!response.ok) {
              throw new Error(`Database download error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            // Проверяем формат данных
            let cardsCount = 0;
            if (Array.isArray(data)) {
              // Старый формат - массив карт
              cardsCount = data.length;
            } else if (data && typeof data === 'object' && data.cards && Array.isArray(data.cards)) {
              // Новый формат - объект с полем cards
              cardsCount = data.cards.length;
            }
            
            console.log(`✅ Database downloaded successfully: ${cardsCount} cards`);
            sendResponse({ success: true, data: data }); // Возвращаем оригинальные данные
          } catch (error) {
            console.error('❌ Database download failed:', error);
            sendResponse({ success: false, error: error instanceof Error ? error.message : 'Failed to download database' });
          }
          break;

        case 'getRelease':
          console.log('🔄 Get release info requested');
          try {
            const response = await fetch(message.data.apiUrl, {
              headers: {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'AnimestarsCards-Extension'
              }
            });
            
            if (!response.ok) {
              throw new Error(`GitHub API error! status: ${response.status}`);
            }
            
            const releaseData = await response.json();
            console.log('✅ Release data fetched successfully');
            sendResponse({ success: true, data: releaseData });
          } catch (error) {
            console.error('❌ Get release failed:', error);
            sendResponse({ success: false, error: error instanceof Error ? error.message : 'Failed to get release info' });
          }
          break;

        case 'downloadData':
          console.log('📥 Download data requested:', message.data?.url);
          try {
            // Пробуем несколько способов загрузки
            let response;
            let data;
            
            // Способ 1: прямой запрос
            try {
              console.log('🔄 Trying direct fetch...');
              response = await fetch(message.data.url, {
                headers: {
                  'Accept': 'application/vnd.github.v3+json',
                  'User-Agent': 'AnimestarsCards-Extension'
                }
              });
              
              if (response.ok) {
                data = await response.json();
                console.log('✅ Direct fetch successful');
              } else {
                console.log('❌ Direct fetch failed:', response.status, response.statusText);
              }
            } catch (fetchError) {
              console.log('❌ Direct fetch error:', fetchError);
            }
            
            // Способ 2: через GitHub API (если прямой не работает)
            if (!data) {
              console.log('🔄 Trying GitHub API...');
              // Извлекаем информацию о релизе
              const urlParts = message.data.url.match(/\/([^\/]+)\/([^\/]+)\/releases\/download\/([^\/]+)\/(.+)/);
              if (urlParts) {
                const [, owner, repo, tag, filename] = urlParts;
                
                // Получаем информацию о релизе
                const releaseResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`, {
                  headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'AnimestarsCards-Extension'
                  }
                });
                
                if (releaseResponse.ok) {
                  const releaseData = await releaseResponse.json();
                  const asset = releaseData.assets.find((a: any) => a.name === filename);
                  
                  if (asset) {
                    // Пробуем скачать через API URL
                    const assetResponse = await fetch(asset.url, {
                      headers: {
                        'Accept': 'application/octet-stream',
                        'User-Agent': 'AnimestarsCards-Extension'
                      }
                    });
                    
                    if (assetResponse.ok) {
                      data = await assetResponse.json();
                      console.log('✅ GitHub API fetch successful');
                    }
                  }
                }
              }
            }
            
            if (!data) {
              throw new Error('All download methods failed');
            }
            
            console.log('✅ Successfully downloaded', data.length, 'cards');
            sendResponse({ success: true, data });
          } catch (fetchError) {
            console.error('❌ Download failed:', fetchError);
            const errorMessage = fetchError instanceof Error ? fetchError.message : 'Download failed';
            sendResponse({ success: false, error: errorMessage });
          }
          break;

        case 'forceUpdate':
          console.log('🔄 Force update requested');
          const result = await this.githubService.updateDatabase();
          sendResponse(result);
          break;

        case 'clearDatabase':
          console.log('🗑️ Database clear requested');
          try {
            await this.dbService.deleteDatabase();
            // Пересоздаем базу данных после удаления
            await this.dbService.init();
            console.log('✅ Database cleared and recreated successfully');
            sendResponse({ success: true });
          } catch (error) {
            console.error('❌ Error clearing database:', error);
            sendResponse({ 
              success: false, 
              error: error instanceof Error ? error.message : 'Unknown error' 
            });
          }
          break;

        case 'getDatabaseInfo':
          const info = await this.dbService.getDatabaseInfo();
          const cardsCount = await this.dbService.getCardsCount();
          sendResponse({
            version: info?.version || 'unknown',
            timestamp: info?.timestamp,
            totalCards: info?.totalCards || cardsCount,
            filename: info?.filename,
            downloadUrl: info?.downloadUrl,
            cardsCount,
            lastUpdate: info?.timestamp ? new Date(parseInt(info.timestamp) * 1000).toISOString() : undefined
          });
          break;

        case 'getCardsCount':
          const count = await this.dbService.getCardsCount();
          sendResponse({ success: true, data: count });
          break;

        case 'getCardStats':
          if (message.data && message.data.cardId) {
            const stats = await this.dbService.getCardStats(message.data.cardId);
            sendResponse({ success: true, data: stats });
          } else {
            sendResponse({ success: false, data: null });
          }
          break;

        case 'checkUpdates':
          const currentInfo = await this.dbService.getDatabaseInfo();
          const needsUpdate = await this.githubService.checkForUpdates(currentInfo);
          sendResponse({ needsUpdate });
          break;

        default:
          console.warn('⚠️ Unknown message type:', message.type);
          sendResponse({ error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('❌ Error handling message:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      sendResponse({ error: errorMessage });
    }
  }

  private async notifyTabs(type: string, data: any): Promise<void> {
    try {
      const tabs = await chrome.tabs.query({});
      
      for (const tab of tabs) {
        if (tab.id && this.isAnimestarsTab(tab.url)) {
          try {
            await chrome.tabs.sendMessage(tab.id, {
              type,
              data
            });
          } catch (error) {
            // Игнорируем ошибки для неактивных tabs
          }
        }
      }
    } catch (error) {
      console.error('❌ Error notifying tabs:', error);
    }
  }

  private isAnimestarsTab(url?: string): boolean {
    if (!url) return false;
    return url.includes('animestars.org') || url.includes('asstars.tv');
  }

  public checkIsAnimestarsTab(url?: string): boolean {
    return this.isAnimestarsTab(url);
  }
}

// Инициализация background service
const backgroundService = new BackgroundService();
backgroundService.init().catch(console.error);

// Обработка установки расширения
chrome.runtime.onInstalled.addListener((details: chrome.runtime.InstalledDetails) => {
  if (details.reason === 'install') {
    console.log('🎉 AnimestarsCards Stats Extension installed!');
    
    // Открываем страницу приветствия или настроек
    chrome.tabs.create({
      url: 'https://github.com/hantYT/animestars-card-stats-ext'
    });
  } else if (details.reason === 'update') {
    console.log('🔄 AnimestarsCards Stats Extension updated!');
  }
});

// Обработка активации расширения
chrome.action.onClicked.addListener((tab: chrome.tabs.Tab) => {
  if (tab.id && backgroundService.checkIsAnimestarsTab(tab.url)) {
    // На страницах animestars открываем popup
    chrome.action.setPopup({
      tabId: tab.id,
      popup: 'popup.html'
    });
  } else {
    // На других страницах перенаправляем на animestars
    chrome.tabs.create({
      url: 'https://animestars.org'
    });
  }
});

// Экспортируем для отладки
(globalThis as any).backgroundService = backgroundService;
