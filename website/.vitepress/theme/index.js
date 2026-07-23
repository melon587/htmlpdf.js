import DefaultTheme from 'vitepress/theme';
import LiveDemo from './LiveDemo.vue';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('LiveDemo', LiveDemo);
  },
};
