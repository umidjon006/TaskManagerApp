// Brauzer: mahalliy eslatmalar yo'q. capacitor-notifications.js bilan bir xil interfeys, hammasi no-op.
// Brauzer Notification API'si ataylab ishlatilmaydi: sahifa yopiq bo'lsa u baribir ishlamaydi.

export async function isSupported() {
  return false;
}

export async function checkPermissions() {
  return { notifications: 'denied', exactAlarm: 'denied' };
}

export async function requestPermissions() {
  return checkPermissions();
}

export async function ensureChannel() {}

export async function cancelAll() {}

export async function schedule() {}

export async function pending() {
  return [];
}

export async function openChannelSettings() {
  return false;
}

export async function openNotificationSettings() {
  return false;
}

export async function openExactAlarmSettings() {
  return false;
}
