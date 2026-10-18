// TEMPORARY (Expo Go preview only) -- REMOVE BEFORE A RELEASE BUILD. See AGENTS.md.
//
// Demo mode swaps the server and the native audio module for fakes so every screen
// and flow can be tried in Expo Go without a backend or a development build.
// It switches on automatically inside Expo Go, or anywhere with EXPO_PUBLIC_DEMO=1.
import Constants, { ExecutionEnvironment } from 'expo-constants';

export const DEMO: boolean =
  process.env.EXPO_PUBLIC_DEMO === '1' || Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export const DEMO_SERVER_URL = 'https://demo.parley.local';
