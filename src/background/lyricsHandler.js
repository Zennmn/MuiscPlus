// ==================================================================================================
// SERVICE WORKER - MAIN
// ==================================================================================================

import { MessageHandler } from './core/messageHandler.js';
import { LyricsService } from './core/lyricsService.js';
import { SettingsManager } from './storage/settings.js';

const pBrowser = typeof browser !== 'undefined'
  ? browser
  : (typeof chrome !== 'undefined' ? chrome : null);

// ==================================================================================================
// INITIALIZATION
// ==================================================================================================

console.log('Service Worker initialized');
SettingsManager.getLyricsSettings().catch(error => {
  console.warn('Service Worker: could not migrate lyrics source settings', error);
});
LyricsService.maintainCache();

if (pBrowser?.runtime?.onMessage) {
  pBrowser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    return MessageHandler.handle(message, sender, sendResponse);
  });
} else {
  console.error('Service Worker: runtime messaging not available');
}
