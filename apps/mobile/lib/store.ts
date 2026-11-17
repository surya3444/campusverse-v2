// Phones: tokens and settings live in the OS keychain / keystore, never in plain storage.
import * as SecureStore from 'expo-secure-store';

export const store = {
  get: (key: string) => SecureStore.getItemAsync(key),
  set: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  remove: (key: string) => SecureStore.deleteItemAsync(key),
};
