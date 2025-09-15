const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { execSync } = require('child_process');

// Читаем версию из package.json
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const version = packageJson.version;
const name = packageJson.name;

console.log('🔧 Запускаем продакшн сборку...');

// Устанавливаем переменную окружения для минификации
process.env.NODE_ENV = 'production';

try {
  // Очищаем папку dist и собираем проект
  execSync('npm run clean', { stdio: 'inherit' });
  execSync('webpack --mode=production', { stdio: 'inherit' });
  
  console.log('✅ Сборка завершена успешно!');
  
  // Создаем архив
  const distPath = path.join(__dirname, '..', 'dist');
  const archiveName = `${name}-v${version}.zip`;
  const archivePath = path.join(__dirname, '..', archiveName);
  
  // Удаляем старый архив если существует
  if (fs.existsSync(archivePath)) {
    fs.unlinkSync(archivePath);
  }
  
  console.log(`📦 Создаем архив: ${archiveName}`);
  
  const output = fs.createWriteStream(archivePath);
  const archive = archiver('zip', {
    zlib: { level: 9 } // Максимальное сжатие
  });
  
  output.on('close', function() {
    const size = (archive.pointer() / 1024 / 1024).toFixed(2);
    console.log(`✅ Архив создан: ${archiveName} (${size} MB)`);
    console.log(`📁 Файлы в архиве: ${archive.pointer()} байт`);
    console.log('🚀 Готово к публикации!');
  });
  
  archive.on('error', function(err) {
    console.error('❌ Ошибка при создании архива:', err);
    throw err;
  });
  
  archive.pipe(output);
  
  // Добавляем содержимое папки dist в архив
  archive.directory(distPath, false);
  
  // Финализируем архив
  archive.finalize();
  
} catch (error) {
  console.error('❌ Ошибка при сборке:', error.message);
  process.exit(1);
}