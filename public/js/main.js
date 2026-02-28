// Nav mobile toggle
const navToggle = document.querySelector('.nav-toggle');
const navLinks = document.querySelector('.nav-links');

if (navToggle && navLinks) {
  navToggle.addEventListener('click', () => {
    navLinks.classList.toggle('open');
  });

  // Close on link click
  navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => navLinks.classList.remove('open'));
  });
}

// Copy button
document.querySelectorAll('.copy-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const targetId = btn.dataset.target;
    const pre = document.getElementById(targetId);
    if (!pre) return;

    const text = pre.textContent;
    navigator.clipboard.writeText(text).then(() => {
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      btn.style.color = 'var(--green)';
      setTimeout(() => {
        btn.textContent = orig;
        btn.style.color = '';
      }, 2000);
    });
  });
});

// Intersection observer — fade in sections
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.1 });

document.querySelectorAll('.step, .threat-item, .integrate-feat, .blind-table-wrap, .problem-callout').forEach(el => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(16px)';
  el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
  observer.observe(el);
});

document.querySelectorAll('.visible').forEach(el => {
  el.style.opacity = '1';
  el.style.transform = 'translateY(0)';
});

// Add visible class logic
const styleTag = document.createElement('style');
styleTag.textContent = '.visible { opacity: 1 !important; transform: translateY(0) !important; }';
document.head.appendChild(styleTag);
