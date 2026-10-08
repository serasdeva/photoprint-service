function readCookie(name) {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : '';
}

document.addEventListener('DOMContentLoaded', () => {
  /* ---------- Mobile navigation ---------- */

  const setBackdropOpen = (open) => {
    document.querySelectorAll('.admin-sidebar-backdrop').forEach((backdrop) => {
      backdrop.classList.toggle('open', open);
      if (open) {
        backdrop.removeAttribute('hidden');
      } else {
        backdrop.setAttribute('hidden', '');
      }
    });
  };

  const closeNav = (toggle, panel) => {
    toggle.setAttribute('aria-expanded', 'false');
    panel.classList.remove('open');
    setBackdropOpen(false);
  };

  document.querySelectorAll('[data-nav-toggle]').forEach((toggle) => {
    const panel = document.getElementById(toggle.getAttribute('aria-controls'));
    if (!panel) return;

    toggle.addEventListener('click', () => {
      const isOpen = panel.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(isOpen));
      setBackdropOpen(isOpen);
    });

    panel.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => closeNav(toggle, panel));
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;

    document.querySelectorAll('[data-nav-toggle]').forEach((toggle) => {
      const panel = document.getElementById(toggle.getAttribute('aria-controls'));
      if (panel && panel.classList.contains('open')) {
        closeNav(toggle, panel);
        toggle.focus();
      }
    });
  });

  document.querySelectorAll('.admin-sidebar-backdrop').forEach((backdrop) => {
    backdrop.addEventListener('click', () => {
      backdrop.classList.remove('open');
      backdrop.setAttribute('hidden', '');
      const sidebar = document.querySelector('.admin-sidebar');
      if (sidebar) sidebar.classList.remove('open');
      const toggle = document.querySelector('[data-nav-toggle="admin-sidebar"]');
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
    });
  });

  /* ---------- Toasts ---------- */

  const dismissToast = (toast) => {
    if (!toast || toast.classList.contains('is-leaving')) return;
    toast.classList.add('is-leaving');
    setTimeout(() => toast.remove(), 260);
  };

  document.querySelectorAll('.toast').forEach((toast) => {
    const closeButton = toast.querySelector('.toast-close');
    if (closeButton) closeButton.addEventListener('click', () => dismissToast(toast));
    setTimeout(() => dismissToast(toast), 6000);
  });

  /* ---------- Scroll reveal ---------- */

  const revealItems = document.querySelectorAll('.reveal');
  if (revealItems.length) {
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add('is-visible');
              observer.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
      );
      revealItems.forEach((item) => observer.observe(item));
    } else {
      revealItems.forEach((item) => item.classList.add('is-visible'));
    }
  }

  /* ---------- Destructive form confirmation ---------- */

  document.querySelectorAll('form[data-confirm]').forEach((form) => {
    form.addEventListener('submit', (event) => {
      if (!window.confirm(form.getAttribute('data-confirm'))) {
        event.preventDefault();
      }
    });
  });

  /* ---------- Order form prefill (query string) ---------- */

  const serviceField = document.getElementById('order-service');
  if (serviceField) {
    const params = new URLSearchParams(window.location.search);
    const service = params.get('service');
    if (service) serviceField.value = service;
  }

  /* ---------- Order forms ---------- */

  document.querySelectorAll('[data-form="order"]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submitButton = form.querySelector('button[type="submit"]');
      const statusNode = form.querySelector('[data-form-status]');

      if (submitButton) {
        submitButton.disabled = true;
        submitButton.classList.add('is-loading');
      }

      try {
        const response = await fetch('/api/orders', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': readCookie('csrf_token'),
          },
          body: JSON.stringify(Object.fromEntries(new FormData(form))),
        });

        const result = await response.json();

        if (!response.ok) {
          const messages = result.errors
            ? result.errors.map((item) => item.msg).join('<br>')
            : result.message;
          if (statusNode) {
            statusNode.innerHTML = `<div class="alert alert-error"><i class="fa-solid fa-circle-exclamation"></i><span>${messages}</span></div>`;
          }
          return;
        }

        if (statusNode) {
          statusNode.innerHTML = `<div class="alert alert-success"><i class="fa-solid fa-circle-check"></i><span>${result.message}</span></div>`;
        }
        form.reset();
      } catch (error) {
        if (statusNode) {
          statusNode.innerHTML =
            '<div class="alert alert-error"><i class="fa-solid fa-circle-exclamation"></i><span>Не удалось отправить заявку. Попробуйте позже.</span></div>';
        }
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.classList.remove('is-loading');
        }
      }
    });
  });
});
