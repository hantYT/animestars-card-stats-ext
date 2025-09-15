import { GitHubRelease, DatabaseInfo, CardData } from './types';

export class GitHubService {
  private static readonly REPO_OWNER = 'hantYT';
  private static readonly REPO_NAME = 'animestars_cards_datasets';
  private static readonly API_BASE = 'https://api.github.com';
  private static readonly DATABASES_PATH = 'databases';

  async getDatabasesList(): Promise<any[]> {
    const apiUrl = `${GitHubService.API_BASE}/repos/${GitHubService.REPO_OWNER}/${GitHubService.REPO_NAME}/contents/${GitHubService.DATABASES_PATH}`;
    
    try {
      console.log('Getting databases list from:', apiUrl);
      
      // Проверяем контекст выполнения
      const isContentScript = typeof window !== 'undefined' && window.location;
      const hasChrome = typeof chrome !== 'undefined' && chrome.runtime;
      
      // Если в content script, отправляем сообщение background script'у
      if (isContentScript && hasChrome) {
        console.log('Getting databases list via background script...');
        const response = await this.sendMessageToBackground('getDatabasesList', { apiUrl });
        
        if (response?.success) {
          return response.data;
        } else {
          throw new Error(response?.error || 'Failed to get databases list via background');
        }
      }

      // Прямой запрос (для background script)
      const response = await fetch(apiUrl, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'AnimestarsCards-Extension'
        }
      });

      if (!response.ok) {
        if (response.status === 404) {
          console.log('Databases folder not found');
          return [];
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const files = await response.json();
      
      // Фильтруем только JSON файлы с нашим паттерном (поддерживаем оба формата)
      const dbFiles = files.filter((file: any) => 
        (file.name.startsWith('animestars_') || file.name.startsWith('animestars_cards_')) && 
        file.name.endsWith('.json') &&
        file.type === 'file'
      );
      
      console.log(`Found ${dbFiles.length} database files`);
      return dbFiles;
    } catch (error) {
      console.error('Error fetching databases list:', error);
      return [];
    }
  }

  async getLatestDatabase(): Promise<any | null> {
    try {
      const databases = await this.getDatabasesList();
      
      if (databases.length === 0) {
        console.log('No database files found');
        return null;
      }

      // Сортируем по имени файла (содержит дату/время)
      databases.sort((a, b) => b.name.localeCompare(a.name));
      
      const latestDb = databases[0];
      console.log(`Latest database: ${latestDb.name}`);
      
      return latestDb;
    } catch (error) {
      console.error('Error getting latest database:', error);
      return null;
    }
  }

  async downloadDatabaseData(downloadUrl: string): Promise<{ metadata: any; cards: CardData[] } | null> {
    try {
      console.log('Downloading database data from:', downloadUrl);
      
      // Проверяем контекст выполнения
      const isContentScript = typeof window !== 'undefined' && window.location;
      const hasChrome = typeof chrome !== 'undefined' && chrome.runtime;
      
      console.log('Context check:', { isContentScript, hasChrome, chromeRuntimeId: chrome?.runtime?.id });
      
      // Если в content script, отправляем сообщение background script'у
      if (isContentScript && hasChrome) {
        try {
          console.log('Attempting download via background script...');
          const response = await this.sendMessageToBackground('downloadDatabase', { url: downloadUrl });
          console.log('Background response:', response);
          
          if (response && response.success) {
            console.log(`Downloaded database with ${response.data.cards?.length || 0} cards via background`);
            return response.data;
          } else {
            throw new Error(response?.error || 'Background download failed');
          }
        } catch (bgError) {
          console.warn('Background download failed:', bgError);
          throw bgError;
        }
      }
      
      // Прямой fetch (для background script)
      console.log('Attempting direct fetch in background context...');
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Проверяем формат данных
      let cards = [];
      let cardsCount = 0;
      
      if (Array.isArray(data)) {
        // Совсем старый формат - массив карт
        cards = data;
        cardsCount = data.length;
      } else if (data && typeof data === 'object' && data.cards && Array.isArray(data.cards)) {
        // Текущий формат - объект с полем cards
        cards = data.cards;
        cardsCount = data.cards.length;
      } else {
        console.warn('Unknown data format:', data);
        cards = [];
        cardsCount = 0;
      }
      
      console.log(`Downloaded database with ${cardsCount} cards`);
      
      return data; // Возвращаем оригинальные данные
    } catch (error) {
      console.error('Error downloading database data:', error);
      return null;
    }
  }

  parseDatabaseInfo(dbFile: any, metadata: any): DatabaseInfo {
    // Извлекаем timestamp из метаданных или имени файла
    let timestamp = metadata?.timestamp;
    let version = metadata?.version || '1.0';
    
    if (!timestamp) {
      // Пытаемся извлечь дату из имени файла: animestars_20250913_210218.json
      const match = dbFile.name.match(/animestars_(\d{8}_\d{6})\.json/);
      if (match) {
        const dateStr = match[1];
        const year = dateStr.substring(0, 4);
        const month = dateStr.substring(4, 6);
        const day = dateStr.substring(6, 8);
        const hour = dateStr.substring(9, 11);
        const minute = dateStr.substring(11, 13);
        const second = dateStr.substring(13, 15);
        
        const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
        timestamp = Math.floor(date.getTime() / 1000);
      } else {
        timestamp = Math.floor(Date.now() / 1000);
      }
    }

    return {
      releaseId: 0, // Не используется в новом формате
      version: `db_${dbFile.name}`,
      timestamp: timestamp.toString(),
      totalCards: metadata?.total_cards || 0,
      filename: dbFile.name,
      downloadUrl: dbFile.download_url
    };
  }

  async checkForUpdates(currentInfo: DatabaseInfo | null): Promise<boolean> {
    const latestDb = await this.getLatestDatabase();
    
    if (!latestDb) {
      console.warn('Could not fetch latest database info');
      return false;
    }

    // Если нет текущей информации о базе данных, нужно обновиться
    if (!currentInfo) {
      console.log('No current database info, update needed');
      return true;
    }

    // Сравниваем имена файлов (содержат дату/время)
    const latestFilename = latestDb.name;
    const currentFilename = currentInfo.filename;

    console.log(`Current database: ${currentFilename}, Latest database: ${latestFilename}`);
    
    return latestFilename !== currentFilename;
  }

  async updateDatabase(): Promise<{ success: boolean; cardsCount?: number; error?: string }> {
    try {
      const latestDb = await this.getLatestDatabase();
      if (!latestDb) {
        return { success: false, error: 'Could not fetch latest database' };
      }

      // Загружаем данные
      const databaseData = await this.downloadDatabaseData(latestDb.download_url);
      if (!databaseData) {
        return { success: false, error: 'Failed to download database data' };
      }

      const { metadata, cards } = databaseData;

      // Просто сохраняем новые данные - метод saveCards сам очистит старые
      const { DatabaseService } = await import('./database');
      const dbService = new DatabaseService();
      await dbService.init();
      
      console.log(`💾 Saving ${cards.length} cards to database...`);
      await dbService.saveCards(cards);

      // Сохраняем информацию о базе данных
      const dbInfo = this.parseDatabaseInfo(latestDb, metadata);
      dbInfo.totalCards = cards.length;
      await dbService.saveDatabaseInfo(dbInfo);

      console.log(`✅ Database updated successfully: ${cards.length} cards`);
      return { success: true, cardsCount: cards.length };

    } catch (error) {
      console.error('❌ Error updating database:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  private async sendMessageToBackground(action: string, data: any): Promise<any> {
    return new Promise((resolve, reject) => {
      // Проверяем, доступен ли chrome.runtime
      if (!chrome?.runtime?.id) {
        reject(new Error('Extension context invalidated'));
        return;
      }

      console.log('Sending message to background:', { action, data });
      
      chrome.runtime.sendMessage(
        { type: action, data },
        (response) => {
          console.log('Background response received:', response);
          console.log('Chrome runtime last error:', chrome.runtime.lastError);
          
          if (chrome.runtime.lastError) {
            // Если background script недоступен, отклоняем промис
            reject(new Error(chrome.runtime.lastError.message));
          } else if (response) {
            resolve(response);
          } else {
            reject(new Error('No response from background script'));
          }
        }
      );
    });
  }
}
