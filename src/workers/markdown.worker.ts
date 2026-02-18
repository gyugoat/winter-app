import { Marked } from 'marked';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import jsonLang from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import yamlLang from 'highlight.js/lib/languages/yaml';
import markdownLang from 'highlight.js/lib/languages/markdown';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('jsx', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('tsx', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('json', jsonLang);
hljs.registerLanguage('css', css);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('rs', rust);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('yaml', yamlLang);
hljs.registerLanguage('yml', yamlLang);
hljs.registerLanguage('markdown', markdownLang);
hljs.registerLanguage('md', markdownLang);

const marked = new Marked({ breaks: true, gfm: true });

const renderer = {
  code({ text, lang }: { text: string; lang?: string | undefined }) {
    const language = lang && hljs.getLanguage(lang) ? lang : '';
    const highlighted = language
      ? hljs.highlight(text, { language }).value
      : hljs.highlightAuto(text).value;
    const encoded = encodeURIComponent(text);
    return `<div class="code-block-wrap"><div class="code-block-header"><span class="code-block-lang">${language || 'text'}</span><button class="code-copy-btn" data-code="${encoded}">Copy</button></div><pre><code class="hljs${language ? ` language-${language}` : ''}">${highlighted}</code></pre></div>`;
  },
};

marked.use({ renderer });

export interface WorkerRequest {
  id: string;
  content: string;
}

export interface WorkerResponse {
  id: string;
  html: string;
}

self.onmessage = (e: MessageEvent<WorkerRequest | WorkerRequest[]>) => {
  const items = Array.isArray(e.data) ? e.data : [e.data];
  for (const item of items) {
    const raw = marked.parse(item.content);
    const html = typeof raw === 'string' ? raw : '';
    (self as unknown as Worker).postMessage({ id: item.id, html } satisfies WorkerResponse);
  }
};
