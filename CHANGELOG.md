# Changelog

All notable changes to AnimestarsCards Stats Extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2025-09-15

### 🚀 New Features
- **Real-time Card Statistics Overlay** - Displays users/need/trade stats directly on card pages
- **Automatic GitHub Database Sync** - Fetches latest card data from GitHub repository automatically
- **Adaptive Statistics Display** - Dynamic sizing and styling based on data volume
  - Compact mode for small values (0-50)
  - Medium mode for normal values (51-200)
  - Extended mode for large values (201+)
- **Glassmorphism UI Design** - Modern semi-transparent interface with blur effects
- **Smart Caching System** - Optimized performance for large datasets (29K+ cards)
- **Multi-site Support** - Works on both animestars.org and asstars.tv
- **Background Auto-updates** - Periodic synchronization with GitHub repository (every 2 hours)
- **Extension Popup Interface** - Convenient management panel with database statistics

### ⚡ Performance Improvements
- **IndexedDB Optimization** - 5x faster data saving and loading compared to localStorage
- **Lazy Loading** - Statistics load only when needed to minimize resource usage
- **Request Caching** - Minimizes redundant API calls with intelligent caching
- **Memory Management** - Efficient data handling in background service worker
- **Batch Processing** - Optimized bulk data operations for large card collections

### 🎨 UI/UX Enhancements
- **Color-coded Statistics** - Intuitive color indicators for different stat types
  - 🟦 Blue for "Users" (card owners)
  - 🟡 Yellow for "Need" (cards wanted)
  - 🟢 Green for "Trade" (cards available for trade)
- **Smooth Animations** - Fluid transitions and appearance effects
- **Responsive Design** - Proper display across different screen resolutions
- **Context-aware Positioning** - Smart overlay placement to avoid UI conflicts
- **Visual Feedback** - Loading states and error handling with user-friendly messages

### 🔧 Technical Features
- **Manifest V3 Compliance** - Full compatibility with latest Chrome extension standards
- **TypeScript 5.2+** - Enhanced type safety and developer experience
- **Modern Build System** - Webpack 5 with production optimizations
  - Code minification with Terser
  - CSS optimization with CssMinimizerPlugin
  - Automatic ZIP packaging for distribution
- **Content Script Injection** - Seamless integration with target websites
- **Service Worker Background** - Persistent data management and updates
- **Cross-context Communication** - Reliable messaging between content scripts and background

### 🛡️ Security & Reliability
- **Minimal Permissions** - Only requests necessary permissions for functionality
- **Error Handling** - Robust error recovery and user feedback
- **Rate Limiting** - Respectful API usage with GitHub rate limit compliance
- **Data Validation** - Input sanitization and type checking
- **Fallback Mechanisms** - Graceful degradation when services are unavailable

### 🔍 Card Detection System
- **Universal Card Selectors** - Supports multiple card layouts and formats:
  - `.anime-cards__item-wrapper` - Main card grid
  - `.trade__inventory-item` - Trading inventory
  - `.trade__main-item` - Trade page items
  - `.trade__item` - Additional trade elements
  - `.trade-card` - Alternative trade format
  - `.inventory-card` - User inventory cards
  - `.history__body-item` - Transaction history
- **Flexible ID Extraction** - Multiple methods for card identification
- **Dynamic Content Support** - Works with both static and dynamically loaded content

### � Database Management
- **Local IndexedDB Storage** - Fast, reliable local data persistence
- **Automated Updates** - Background synchronization with remote database
- **Database Versioning** - Handles schema migrations and updates
- **Conflict Resolution** - Smart merging of local and remote data
- **Statistics Tracking** - Real-time database size and update information

### �️ Developer Tools
- **ESLint + TypeScript** - Consistent code quality and style
- **Modular Architecture** - Clean separation of concerns
- **Debug Logging** - Comprehensive logging for troubleshooting
- **Build Automation** - One-command production builds with `npm run build:prod`
- **Hot Reload Development** - Fast iteration with `npm run dev`

### 🌐 Browser Compatibility
- **Chrome 88+** - Minimum supported version
- **Chromium-based browsers** - Edge, Brave, Opera support
- **Manifest V3 exclusive** - No legacy Manifest V2 support

### 📦 Distribution
- **Automated ZIP Packaging** - Ready-to-publish extension archives
- **Version Synchronization** - Automatic version naming from package.json
- **Optimized Bundle Size** - Minified code and assets (~20KB total)
- **Chrome Web Store Ready** - Meets all store requirements and guidelines

## [Planned Features]

### 🔮 v2.1.0 (In Development)
- **Filtering and Search** - Filter cards by various criteria
- **Advanced Statistics** - Popularity change graphs and trends
- **Theme Customization** - Light/dark themes + color settings
- **Data Export** - Save statistics to files (CSV, JSON)
- **Comparison Tools** - Side-by-side card statistics comparison

### 🚀 v2.2.0 (Planned)
- **Smart Notifications** - Alerts for new cards or price changes
- **AI Recommendations** - Intelligent trading suggestions
- **History Tracking** - Monitor popularity dynamics over time
- **Market Analytics** - Advanced trading insights and trends

## 🛠 For Developers

### Version Structure
- **Major versions (X.0.0)** - Architectural changes and breaking updates
- **Minor versions (X.Y.0)** - New features with backward compatibility
- **Patches (X.Y.Z)** - Bug fixes and minor improvements

### Release Process
1. **Development** in feature branches
2. **Code review** and testing
3. **Merge** to main branch
4. **Automated build** and testing
5. **Release** and documentation update

### Compatibility
- **Chrome 88+** - Minimum supported version
- **Manifest V3 only** - Modern extension standard
- **TypeScript 5.0+** - Latest language features
- **Node.js 16+** - Development environment requirement