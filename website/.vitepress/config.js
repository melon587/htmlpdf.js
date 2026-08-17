import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'htmlpdfx.js',
  description:
    'Browser-native HTML to PDF — real vector text, custom fonts, repeat headers, RTL, gradients.',

  base: '/htmlpdf.js/',

  head: [
    ['meta', { name: 'theme-color', content: '#1677ff' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'htmlpdfx.js' }],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'Browser-native HTML to PDF — real vector text, custom fonts, repeat headers, RTL, gradients.',
      },
    ],
  ],

  themeConfig: {
    siteTitle: 'htmlpdfx.js',

    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'API', link: '/api' },
      { text: 'Demo', link: '/demo' },
      {
        text: 'v1.0.6',
        items: [
          {
            text: 'Changelog',
            link: 'https://github.com/melon587/htmlpdf.js/blob/main/CHANGELOG.md',
          },
          {
            text: 'npm',
            link: 'https://www.npmjs.com/package/htmlpdfx.js',
          },
        ],
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Custom Fonts', link: '/guide/fonts' },
            { text: 'Page Breaks', link: '/guide/page-breaks' },
            { text: 'Header & Footer', link: '/guide/header-footer' },
            { text: 'Repeat Table Header', link: '/guide/repeat-header' },
            { text: 'Known Limitations', link: '/guide/limitations' },
          ],
        },
      ],
      '/api': [
        {
          text: 'API Reference',
          items: [{ text: 'htmlpdf()', link: '/api' }],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/melon587/htmlpdf.js' },
      { icon: 'npm', link: 'https://www.npmjs.com/package/htmlpdfx.js' },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024 melon587',
    },

    editLink: {
      pattern: 'https://github.com/melon587/htmlpdf.js/edit/main/website/:path',
      text: 'Edit this page on GitHub',
    },

    search: {
      provider: 'local',
    },
  },
});
