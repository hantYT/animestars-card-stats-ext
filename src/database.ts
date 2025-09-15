import { CardData, DatabaseInfo } from './types';

export class DatabaseService {
  private static readonly DB_NAME = 'AnimestarsCardsDB';
  private static readonly DB_VERSION = 1;
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

        // Создаем хранилище карт
        if (!db.objectStoreNames.contains(DatabaseService.CARDS_STORE)) {
          const cardsStore = db.createObjectStore(DatabaseService.CARDS_STORE, { keyPath: 'cardId' });
          cardsStore.createIndex('cardName', 'cardName', { unique: false });
          cardsStore.createIndex('animeId', 'animeId', { unique: false });
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
}
