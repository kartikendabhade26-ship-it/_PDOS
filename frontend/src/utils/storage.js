export function saveDrawings(symbol, drawings) {
  try {
    localStorage.setItem(`tv_drawings_${symbol}`, JSON.stringify(drawings));
  } catch (e) {
    console.error("Error saving drawings", e);
  }
}

export function loadDrawings(symbol) {
  try {
    const raw = localStorage.getItem(`tv_drawings_${symbol}`);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error("Error loading drawings", e);
    return [];
  }
}

export function savePreferences(prefs) {
  try {
    localStorage.setItem('tv_preferences', JSON.stringify(prefs));
  } catch (e) {
    console.error("Error saving preferences", e);
  }
}

export function loadPreferences() {
  try {
    const raw = localStorage.getItem('tv_preferences');
    return raw ? JSON.parse(raw) : {
      theme: 'dark',
      showSessions: true,
      magnetMode: false,
      lockDrawings: false
    };
  } catch (e) {
    return {
      theme: 'dark',
      showSessions: true,
      magnetMode: false,
      lockDrawings: false
    };
  }
}
