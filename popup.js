// Popup script для управления расширением
class PopupController {
  constructor() {
    this.content = document.getElementById('content');
    this.loading = document.getElementById('loading');
    this.cardsCountElement = document.getElementById('cardsCount');
    this.lastUpdateElement = document.getElementById('lastUpdate');
    this.statusTextElement = document.getElementById('statusText');
  }

  async init() {
    console.log('🚀 Popup initialized');
    
    // Загружаем информацию о базе данных
    await this.loadDatabaseInfo();
    
    // Настраиваем обработчики событий
    this.setupEventHandlers();
  }

  async loadDatabaseInfo() {
    try {
      const response = await this.sendMessageToBackground('getDatabaseInfo');
      
      if (response && !response.error) {
        this.cardsCountElement.textContent = response.cardsCount?.toString() || '0';
        
        if (response.lastUpdate) {
          const date = new Date(response.lastUpdate);
          this.lastUpdateElement.textContent = this.formatDate(date);
        } else {
          this.lastUpdateElement.textContent = 'Никогда';
        }
        
        this.statusTextElement.textContent = 'База данных готова к использованию';
      } else {
        this.showError('Ошибка загрузки информации о базе данных');
      }
    } catch (error) {
      console.error('Error loading database info:', error);
      this.showError('Не удалось подключиться к базе данных');
    }
  }

  setupEventHandlers() {
    const checkUpdatesBtn = document.getElementById('checkUpdates');
    if (checkUpdatesBtn) {
      checkUpdatesBtn.addEventListener('click', async () => {
        await this.checkForUpdates();
      });
    }

    const forceUpdateBtn = document.getElementById('forceUpdate');
    if (forceUpdateBtn) {
      forceUpdateBtn.addEventListener('click', async () => {
        await this.forceUpdate();
      });
    }

    const clearDatabaseBtn = document.getElementById('clearDatabase');
    if (clearDatabaseBtn) {
      clearDatabaseBtn.addEventListener('click', async () => {
        if (confirm('Вы уверены, что хотите очистить базу данных? Это действие нельзя отменить.')) {
          await this.clearDatabase();
        }
      });
    }

    const openGitHubBtn = document.getElementById('openGitHub');
    if (openGitHubBtn) {
      openGitHubBtn.addEventListener('click', () => {
        chrome.tabs.create({
          url: 'https://github.com/hantYT/animestars-card-stats-ext'
        });
      });
    }
  }

  async checkForUpdates() {
    try {
      this.showLoading(false);
      this.statusTextElement.textContent = 'Проверка обновлений...';

      const response = await this.sendMessageToBackground('checkUpdates');
      
      if (response && !response.error) {
        if (response.needsUpdate) {
          this.statusTextElement.textContent = 'Доступно обновление базы данных';
          this.showSuccess('Найдено обновление! Нажмите "Принудительное обновление"');
        } else {
          this.statusTextElement.textContent = 'База данных актуальна';
          this.showSuccess('База данных уже актуальна');
        }
      } else {
        this.showError('Ошибка проверки обновлений');
      }
    } catch (error) {
      console.error('Error checking updates:', error);
      this.showError('Не удалось проверить обновления');
    }
  }

  async forceUpdate() {
    try {
      this.showLoading(true);

      const response = await this.sendMessageToBackground('forceUpdate');
      
      if (response && response.success) {
        this.showSuccess('База данных обновлена: ' + response.cardsCount + ' карт');
        
        // Обновляем информацию в интерфейсе
        await this.loadDatabaseInfo();
      } else {
        this.showError('Ошибка обновления: ' + (response && response.error ? response.error : 'Неизвестная ошибка'));
      }
    } catch (error) {
      console.error('Error force updating:', error);
      this.showError('Не удалось выполнить обновление');
    } finally {
      this.hideLoading();
    }
  }

  async clearDatabase() {
    try {
      this.showLoading(true);
      this.statusTextElement.textContent = 'Очистка базы данных...';

      const response = await this.sendMessageToBackground('clearDatabase');
      
      if (response && response.success) {
        this.showSuccess('База данных очищена');
        
        // Обновляем информацию в интерфейсе
        await this.loadDatabaseInfo();
      } else {
        this.showError('Ошибка очистки: ' + (response && response.error ? response.error : 'Неизвестная ошибка'));
      }
    } catch (error) {
      console.error('Error clearing database:', error);
      this.showError('Не удалось очистить базу данных');
    } finally {
      this.hideLoading();
    }
  }

  showLoading(hideContent) {
    if (hideContent === undefined) hideContent = false;
    this.loading.classList.add('active');
    if (hideContent) {
      this.content.style.display = 'none';
    }
  }

  hideLoading() {
    this.loading.classList.remove('active');
    this.content.style.display = 'block';
  }

  showError(message) {
    this.hideLoading();
    this.removeMessages();
    
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error';
    errorDiv.textContent = message;
    
    this.content.insertBefore(errorDiv, this.content.firstChild);
    
    // Удаляем сообщение через 5 секунд
    setTimeout(() => {
      if (errorDiv.parentNode) {
        errorDiv.parentNode.removeChild(errorDiv);
      }
    }, 5000);
  }

  showSuccess(message) {
    this.hideLoading();
    this.removeMessages();
    
    const successDiv = document.createElement('div');
    successDiv.className = 'success';
    successDiv.textContent = message;
    
    this.content.insertBefore(successDiv, this.content.firstChild);
    
    // Удаляем сообщение через 3 секунды
    setTimeout(() => {
      if (successDiv.parentNode) {
        successDiv.parentNode.removeChild(successDiv);
      }
    }, 3000);
  }

  removeMessages() {
    const messages = this.content.querySelectorAll('.error, .success');
    messages.forEach(msg => {
      if (msg.parentNode) {
        msg.parentNode.removeChild(msg);
      }
    });
  }

  async sendMessageToBackground(type, data) {
    if (data === undefined) data = {};
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(Object.assign({ type: type }, data), (response) => {
        resolve(response);
      });
    });
  }

  formatDate(date) {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) {
      return 'Только что';
    } else if (diffHours < 24) {
      return diffHours + ' ч. назад';
    } else if (diffDays === 1) {
      return 'Вчера';
    } else if (diffDays < 7) {
      return diffDays + ' дн. назад';
    } else {
      return date.toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit'
      });
    }
  }
}

// Инициализация popup при загрузке
document.addEventListener('DOMContentLoaded', () => {
  const popup = new PopupController();
  popup.init().catch(console.error);
});
