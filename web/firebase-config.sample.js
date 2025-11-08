// Copy this file to firebase-config.js and replace the placeholder values
// with the credentials from your Firebase project settings.

export const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_PROJECT.appspot.com',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID',
};

// Any email in this list will automatically receive ADMIN + HEAD_OFFICE roles
// the first time they sign in. Update it to match your organization.
export const defaultSuperAdmins = ['rsaisankalp@gmail.com'];
