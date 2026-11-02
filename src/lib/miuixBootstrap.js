import './miuixBridge.js';

// Compose Web's loader must run as a local script under the extension CSP.
const script = document.createElement('script');
script.src = new URL('../miuix/muiscMiuix.js', import.meta.url).href;
script.addEventListener('error', () => {
    const loading = document.getElementById('miuix-loading');
    if (loading) loading.textContent = globalThis.msg?.('msgErrorLoadingSettings') || 'Could not load the settings interface.';
}, { once: true });
window.addEventListener('unhandledrejection', () => {
    const loading = document.getElementById('miuix-loading');
    if (loading) loading.textContent = globalThis.msg?.('msgErrorLoadingSettings') || 'Could not load the settings interface.';
});
document.head.appendChild(script);
