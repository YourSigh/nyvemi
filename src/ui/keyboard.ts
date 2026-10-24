import { Keyboard } from 'react-native';
export async function closeKeyboard(): Promise<void> {
  if (!Keyboard.isVisible()) return;
  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timeout);
      subscription.remove();
      resolve();
    };
    const subscription = Keyboard.addListener('keyboardDidHide', finish);
    const timeout = setTimeout(finish, 450);
    Keyboard.dismiss();
  });
}
