'use strict';

// ---------------------------------------------------------------------------
// Mobile nav toggle
// ---------------------------------------------------------------------------

const navToggle = document.querySelector('.nav-toggle');
const navLinks = document.querySelector('.nav-links');

if (navToggle && navLinks) {
  navToggle.addEventListener('click', () => navLinks.classList.toggle('open'));

  // Close the menu when the user taps any nav link.
  navLinks.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => navLinks.classList.remove('open'));
  });
}

// ---------------------------------------------------------------------------
// Copy-to-clipboard buttons
// ---------------------------------------------------------------------------

document.querySelectorAll('.copy-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const pre = document.getElementById(btn.dataset.target);
    if (!pre) return;

    navigator.clipboard.writeText(pre.textContent).then(() => {
      const original = btn.textContent;
      btn.textContent = 'Copied!';
      btn.style.color = 'var(--green)';
      setTimeout(() => {
        btn.textContent = original;
        btn.style.color = '';
      }, 2000);
    });
  });
});

// ---------------------------------------------------------------------------
// Scroll-triggered fade-in via IntersectionObserver
// ---------------------------------------------------------------------------

/**
 * Selector for all elements that should animate in as they enter the viewport.
 * Matches the CSS class names used in index.html.
 */
const ANIMATED_SELECTOR = '.step, .threat-item, .integrate-feat, .blind-table-wrap, .problem-callout';

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target); // animate once, then stop observing
      }
    });
  },
  { threshold: 0.1 }
);

document.querySelectorAll(ANIMATED_SELECTOR).forEach((el) => {
  // Initial hidden state set via JS so elements are visible if JS is disabled.
  el.style.opacity = '0';
  el.style.transform = 'translateY(16px)';
  el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
  observer.observe(el);
});

// The `visible` class overrides the inline hidden state once the element
// enters the viewport.  Defined in the stylesheet (index.html <style> block).
