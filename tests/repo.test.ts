import { describe, expect, it } from 'vitest';
import { guessRepo, workflowUrl } from '../src/client/store';

describe('repository detection from the Pages URL', () => {
  it('handles a project site with and without a trailing slash', () => {
    expect(guessRepo('', 'https://obed-cudjoe.github.io/NLA-LOTTO')).toBe('obed-cudjoe/NLA-LOTTO');
    expect(guessRepo('', 'https://obed-cudjoe.github.io/NLA-LOTTO/')).toBe('obed-cudjoe/NLA-LOTTO');
    expect(guessRepo('', 'https://obed-cudjoe.github.io/NLA-LOTTO/index.html')).toBe(
      'obed-cudjoe/NLA-LOTTO'
    );
    expect(guessRepo('', 'https://obed-cudjoe.github.io/NLA-LOTTO/?x=1#top')).toBe(
      'obed-cudjoe/NLA-LOTTO'
    );
  });

  it('treats a bare owner.github.io as a root user site', () => {
    expect(guessRepo('', 'https://obed-cudjoe.github.io/')).toBe('obed-cudjoe/obed-cudjoe.github.io');
    expect(guessRepo('', 'https://obed-cudjoe.github.io')).toBe('obed-cudjoe/obed-cudjoe.github.io');
  });

  it('prefers a saved repository over the guess', () => {
    expect(guessRepo('Obed-Cudjoe/NLA-LOTTO', 'https://obed-cudjoe.github.io/other/')).toBe(
      'Obed-Cudjoe/NLA-LOTTO'
    );
  });

  it('returns nothing off GitHub Pages, or for rubbish input', () => {
    expect(guessRepo('', 'http://localhost:8788/')).toBe('');
    expect(guessRepo('', 'https://example.com/NLA-LOTTO/')).toBe('');
    expect(guessRepo('', 'not a url')).toBe('');
    expect(guessRepo('   ', 'https://obed-cudjoe.github.io/NLA-LOTTO/')).toBe('obed-cudjoe/NLA-LOTTO');
  });

  it('builds the Actions deep link from the detected repo', () => {
    expect(workflowUrl('Obed-Cudjoe/NLA-LOTTO')).toBe(
      'https://github.com/Obed-Cudjoe/NLA-LOTTO/actions/workflows/refresh-draws.yml'
    );
    expect(workflowUrl('')).toBe('https://github.com');
  });
});
