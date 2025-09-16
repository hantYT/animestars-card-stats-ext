import { CardData, DatabaseInfo } from './types';

export class DatabaseService {
  private static readonly DB_NAME = 'AnimestarsCardsDB';
  private static readonly DB_VERSION = 2; // Увеличиваем версию для создания нового индекса
  private static readonly CARDS_STORE = 'cards';
  private static readonly INFO_STORE = 'info';

  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DatabaseService.DB_NAME, DatabaseService.DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const transaction = (event.target as IDBOpenDBRequest).transaction!;

        // Создаем хранилище карт
        if (!db.objectStoreNames.contains(DatabaseService.CARDS_STORE)) {
          const cardsStore = db.createObjectStore(DatabaseService.CARDS_STORE, { keyPath: 'cardId' });
          cardsStore.createIndex('cardName', 'cardName', { unique: false });
          cardsStore.createIndex('animeId', 'animeId', { unique: false });
          cardsStore.createIndex('cardImage', 'cardImage', { unique: false }); // Индекс для быстрого поиска по URL изображения
        } else {
          // Обновляем существующее хранилище, если нужно добавить новые индексы
          const cardsStore = transaction.objectStore(DatabaseService.CARDS_STORE);
          
          // Добавляем индекс для cardImage, если его еще нет (версия 2)
          if (!cardsStore.indexNames.contains('cardImage')) {
            cardsStore.createIndex('cardImage', 'cardImage', { unique: false });
          }
        }

        // Создаем хранилище информации о базе
        if (!db.objectStoreNames.contains(DatabaseService.INFO_STORE)) {
          db.createObjectStore(DatabaseService.INFO_STORE, { keyPath: 'key' });
        }
      };
    });
  }

  async saveCards(cards: CardData[]): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    console.log(`Starting to save ${cards.length} cards to IndexedDB`);

    // Очищаем старые данные
    await this.clearCards();
    console.log('Old cards cleared from IndexedDB');

    // Создаем новую транзакцию для сохранения данных
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([DatabaseService.CARDS_STORE], 'readwrite');
      const store = transaction.objectStore(DatabaseService.CARDS_STORE);
      
      let completed = 0;
      let hasError = false;

      transaction.oncomplete = () => {
        if (!hasError) {
          console.log(`✅ Saved ${completed}/${cards.length} cards to IndexedDB`);
          resolve();
        }
      };

      transaction.onerror = () => {
        hasError = true;
        console.error('Transaction error:', transaction.error);
        reject(transaction.error);
      };

      // Добавляем карты пакетами для избежания блокировки
      for (const card of cards) {
        const request = store.put(card); // Используем put вместо add для замены существующих записей
        
        request.onsuccess = () => {
          completed++;
          if (completed % 50 === 0) {
            console.log(`Progress: ${completed}/${cards.length} cards saved`);
          }
        };
        
        request.onerror = () => {
          hasError = true;
          console.error(`Error saving card ${card.cardId}:`, request.error);
          reject(request.error);
        };
      }
    });
  }

  async getCardStats(cardId: number): Promise<{ users: number; need: number; trade: number } | null> {
    if (!this.db) {
      console.log('🔄 Database not initialized, auto-initializing...');
      await this.init();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([DatabaseService.CARDS_STORE], 'readonly');
      const store = transaction.objectStore(DatabaseService.CARDS_STORE);
      const request = store.get(cardId);

      request.onsuccess = () => {
        const card = request.result as CardData;
        if (card) {
          resolve({
            users: card.users,
            need: card.need,
            trade: card.trade
          });
        } else {
          resolve(null);
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  async clearCards(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([DatabaseService.CARDS_STORE], 'readwrite');
      const store = transaction.objectStore(DatabaseService.CARDS_STORE);
      const request = store.clear();

      request.onsuccess = () => {
        console.log('IndexedDB cards store cleared');
        resolve();
      };
      request.onerror = () => {
        console.error('Error clearing cards store:', request.error);
        reject(request.error);
      };
    });
  }

  async clearAll(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      // Очищаем и карты, и информацию о базе
      const transaction = this.db!.transaction([DatabaseService.CARDS_STORE, DatabaseService.INFO_STORE], 'readwrite');
      
      const cardsStore = transaction.objectStore(DatabaseService.CARDS_STORE);
      const infoStore = transaction.objectStore(DatabaseService.INFO_STORE);
      
      let clearOperations = 0;
      let completedOperations = 0;

      transaction.oncomplete = () => {
        console.log('IndexedDB completely cleared');
        resolve();
      };

      transaction.onerror = () => {
        console.error('Error clearing IndexedDB:', transaction.error);
        reject(transaction.error);
      };

      // Очищаем карты
      const clearCardsRequest = cardsStore.clear();
      clearOperations++;
      clearCardsRequest.onsuccess = () => {
        completedOperations++;
        console.log('Cards store cleared');
      };

      // Очищаем информацию
      const clearInfoRequest = infoStore.clear();
      clearOperations++;
      clearInfoRequest.onsuccess = () => {
        completedOperations++;
        console.log('Info store cleared');
      };
    });
  }

  async saveDatabaseInfo(info: DatabaseInfo): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([DatabaseService.INFO_STORE], 'readwrite');
      const store = transaction.objectStore(DatabaseService.INFO_STORE);
      const request = store.put({ key: 'info', ...info });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getDatabaseInfo(): Promise<DatabaseInfo | null> {
    if (!this.db) {
      console.log('🔄 Database not initialized, auto-initializing...');
      await this.init();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([DatabaseService.INFO_STORE], 'readonly');
      const store = transaction.objectStore(DatabaseService.INFO_STORE);
      const request = store.get('info');

      request.onsuccess = () => {
        const result = request.result;
        if (result) {
          const { key, ...info } = result;
          resolve(info as DatabaseInfo);
        } else {
          resolve(null);
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  async deleteDatabase(): Promise<void> {
    console.log('🗑️ Starting database deletion process...');
    
    return new Promise((resolve, reject) => {
      // Закрываем текущее соединение
      if (this.db) {
        console.log('📱 Closing current database connection...');
        this.db.close();
        this.db = null;
      }

      // Ждем немного чтобы соединение точно закрылось
      setTimeout(() => {
        console.log('🔄 Attempting to delete database...');
        
        // Удаляем базу данных
        const deleteRequest = indexedDB.deleteDatabase(DatabaseService.DB_NAME);
        
        deleteRequest.onsuccess = () => {
          console.log('✅ Database deleted successfully');
          resolve();
        };
        
        deleteRequest.onerror = () => {
          console.error('❌ Error deleting database:', deleteRequest.error);
          reject(deleteRequest.error);
        };
        
        deleteRequest.onblocked = () => {
          console.warn('⚠️ Database deletion blocked by active connections');
          console.warn('🔄 Attempting to wait for connections to close...');
          
          // Даем больше времени для закрытия соединений
          setTimeout(() => {
            console.log('⏰ Timeout waiting for database deletion, proceeding anyway...');
            // Не отклоняем, а пытаемся очистить данные другим способом
            resolve();
          }, 3000);
        };
        
      }, 200); // Даем 200мс для закрытия соединения
    });
  }

  async clearAllData(): Promise<void> {
    console.log('🧹 Clearing all data from database...');
    
    if (!this.db) {
      console.log('📱 Database not connected, initializing...');
      await this.init();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([DatabaseService.CARDS_STORE, DatabaseService.INFO_STORE], 'readwrite');
      
      transaction.oncomplete = () => {
        console.log('✅ All data cleared successfully');
        resolve();
      };
      
      transaction.onerror = () => {
        console.error('❌ Error clearing data:', transaction.error);
        reject(transaction.error);
      };

      // Очищаем хранилище карт
      const cardsStore = transaction.objectStore(DatabaseService.CARDS_STORE);
      cardsStore.clear();
      
      // Очищаем хранилище информации
      const infoStore = transaction.objectStore(DatabaseService.INFO_STORE);
      infoStore.clear();
    });
  }

  async getCardsCount(): Promise<number> {
    if (!this.db) {
      console.log('🔄 Database not initialized, auto-initializing...');
      await this.init();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([DatabaseService.CARDS_STORE], 'readonly');
      const store = transaction.objectStore(DatabaseService.CARDS_STORE);
      const request = store.count();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async findCardByImageUrl(imageUrl: string): Promise<number | null> {
    if (!this.db) {
      console.log('🔄 Database not initialized, auto-initializing...');
      await this.init();
    }

    // Улучшенная нормализация URL
    const normalizeUrl = (url: string): string => {
      // Убираем протокол и домен
      let normalized = url.replace(/^https?:\/\/[^\/]+/, '');
      // Убираем или добавляем ведущий слеш для единообразия
      normalized = normalized.replace(/^\/+/, '');
      // Убираем параметры и якори
      normalized = normalized.split('?')[0].split('#')[0];
      return normalized;
    };

    const normalizedSearchUrl = normalizeUrl(imageUrl);
    console.log('🔍 Searching for card by URL:', normalizedSearchUrl);

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([DatabaseService.CARDS_STORE], 'readonly');
      const store = transaction.objectStore(DatabaseService.CARDS_STORE);
      const imageIndex = store.index('cardImage');

      // 1. Попробуем точный поиск по индексу с нормализованным URL
      const exactRequest = imageIndex.get(normalizedSearchUrl);
      
      exactRequest.onsuccess = () => {
        if (exactRequest.result) {
          resolve(exactRequest.result.cardId);
          return;
        }
        
        // 2. Попробуем поиск с ведущим слешем
        const withSlashRequest = imageIndex.get('/' + normalizedSearchUrl);
        
        withSlashRequest.onsuccess = () => {
          if (withSlashRequest.result) {
            resolve(withSlashRequest.result.cardId);
            return;
          }
          
          // 3. Fallback - используем курсор для частичного поиска только если точный поиск не дал результатов
          const cursorRequest = imageIndex.openCursor();
          
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            
            if (cursor) {
              const card = cursor.value as CardData;
              const normalizedCardImage = normalizeUrl(card.cardImage);
              
              // Проверяем частичное совпадение
              if (normalizedCardImage.includes(normalizedSearchUrl) || 
                  normalizedSearchUrl.includes(normalizedCardImage)) {
                resolve(card.cardId);
                return;
              }
              
              cursor.continue();
            } else {
              // 4. Последний шанс - поиск по имени файла
              this.findCardByFileName(normalizedSearchUrl, resolve);
            }
          };
          
          cursorRequest.onerror = () => reject(cursorRequest.error);
        };
        
        withSlashRequest.onerror = () => reject(withSlashRequest.error);
      };
      
      exactRequest.onerror = () => reject(exactRequest.error);
    });
  }

  private findCardByFileName(searchUrl: string, resolve: (value: number | null) => void): void {
    const searchFileName = searchUrl.split('/').pop();
    if (!searchFileName) {
      resolve(null);
      return;
    }

    const transaction = this.db!.transaction([DatabaseService.CARDS_STORE], 'readonly');
    const store = transaction.objectStore(DatabaseService.CARDS_STORE);
    const imageIndex = store.index('cardImage');
    const cursorRequest = imageIndex.openCursor();

    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      
      if (cursor) {
        const card = cursor.value as CardData;
        const cardFileName = card.cardImage.split('/').pop();
        
        if (cardFileName && cardFileName === searchFileName) {
          resolve(card.cardId);
          return;
        }
        
        cursor.continue();
      } else {
        resolve(null);
      }
    };
  }
}
