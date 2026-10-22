import { Component, type PropsWithChildren } from 'react';
import { Button, ErrorText, Page } from './components';
export class ScreenErrorBoundary extends Component<
  PropsWithChildren<{ report: () => void }>,
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  componentDidCatch(): void {
    this.props.report();
  }
  render() {
    if (this.state.failed)
      return (
        <Page>
          <ErrorText text="页面遇到问题。已保存的本地资料不会被清空。" />
          <Button title="重新打开页面" onPress={() => this.setState({ failed: false })} />
        </Page>
      );
    return this.props.children;
  }
}
