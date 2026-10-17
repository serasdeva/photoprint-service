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
    toggle.setAttribute('aria-label', 'Открыть меню');
    panel.classList.remove('open');
    panel.inert = window.matchMedia('(max-width: 980px)').matches;
    setBackdropOpen(false);
  };

  document.querySelectorAll('[data-nav-toggle]').forEach((toggle) => {
    const panel = document.getElementById(toggle.getAttribute('aria-controls'));
    if (!panel) return;

    const mobileNav = window.matchMedia('(max-width: 980px)');
    const updateNavAccessibility = () => {
      const isOpen = panel.classList.contains('open');
      panel.inert = mobileNav.matches && !isOpen;
      toggle.setAttribute('aria-label', isOpen ? 'Закрыть меню' : 'Открыть меню');
    };

    updateNavAccessibility();
    mobileNav.addEventListener('change', updateNavAccessibility);

    toggle.addEventListener('click', () => {
      const isOpen = panel.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(isOpen));
      updateNavAccessibility();
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
      if (toggle && sidebar) closeNav(toggle, sidebar);
    });
  });

  /* ---------- Site settings preview ---------- */

  const heroTitleInput = document.getElementById('s-heroTitle');
  const heroSubtitleInput = document.getElementById('s-heroSubtitle');
  const previewTitle = document.querySelector('[data-settings-preview-title]');
  const previewSubtitle = document.querySelector('[data-settings-preview-subtitle]');

  if (heroTitleInput && heroSubtitleInput && previewTitle && previewSubtitle) {
    const updatePreview = () => {
      previewTitle.textContent = heroTitleInput.value.trim() || 'Заголовок первого экрана';
      previewSubtitle.textContent = heroSubtitleInput.value.trim() || 'Подзаголовок первого экрана';
    };

    heroTitleInput.addEventListener('input', updatePreview);
    heroSubtitleInput.addEventListener('input', updatePreview);
  }

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

  /* ---------- Copy buttons ---------- */
  document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const text = btn.getAttribute('data-copy') || '';
      const raw = text.startsWith('tel:') ? text.slice(4) : text;
      try {
        await navigator.clipboard.writeText(raw);
        const prev = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Скопировано';
        setTimeout(() => {
          btn.innerHTML = prev;
        }, 1600);
      } catch (_) {
        window.prompt('Скопируйте:', raw);
      }
    });
  });

  /* ---------- Sticky CTA ---------- */
  const sticky = document.getElementById('sticky-cta');
  const orderForm = document.querySelector('[data-form="order"]');
  if (sticky && orderForm) {
    const dismissed = (() => {
      try {
        return localStorage.getItem('sticky-cta-dismissed') === '1';
      } catch {
        return true;
      }
    })();
    let shown = false;
    const hide = () => {
      sticky.hidden = true;
      try {
        localStorage.setItem('sticky-cta-dismissed', '1');
      } catch {}
    };
    sticky.querySelector('.sticky-cta-close')?.addEventListener('click', hide);
    sticky.querySelectorAll('a').forEach((a) => a.addEventListener('click', hide));
    const stickyOrder = sticky.querySelector('[data-sticky-order]');
    if (stickyOrder && !document.getElementById('order-form')) {
      stickyOrder.setAttribute('href', '/contacts');
    }
    if (!dismissed) {
      const obs = new IntersectionObserver(
        (entries) => {
          const visible = entries[0]?.isIntersecting;
          if (!visible && !shown) {
            sticky.hidden = false;
            shown = true;
          }
          if (visible) sticky.hidden = true;
        },
        { threshold: 0.1 }
      );
      obs.observe(orderForm);
      window.addEventListener(
        'scroll',
        () => {
          if (window.scrollY > 900 && !shown) {
            sticky.hidden = false;
            shown = true;
          }
        },
        { once: true }
      );
    }
  }

  /* ---------- Home services live search ---------- */
  const svcSearch = document.querySelector('[data-services-search]');
  const svcGrid = document.querySelector('[data-services-grid]');
  const svcStatus = document.querySelector('[data-services-status]');
  const svcEmpty = document.querySelector('[data-services-empty]');
  if (svcSearch && svcGrid) {
    const cards = Array.from(svcGrid.querySelectorAll('[data-service-card]'));
    const apply = () => {
      const q = svcSearch.value.trim().toLowerCase();
      let visible = 0;
      cards.forEach((c) => {
        const hit =
          !q || c.getAttribute('data-title').includes(q) || c.getAttribute('data-desc').includes(q);
        c.classList.toggle('is-hidden', !hit);
        if (hit) visible += 1;
      });
      if (svcStatus) svcStatus.textContent = q ? `Найдено: ${visible}` : '';
      if (svcEmpty) svcEmpty.classList.toggle('is-hidden', visible !== 0);
    };
    svcSearch.addEventListener('input', apply);
    document.querySelector('[data-services-reset]')?.addEventListener('click', () => {
      svcSearch.value = '';
      apply();
      svcSearch.focus();
    });
  }

  /* ---------- Phone mask + inline validation + char count ---------- */
  function formatPhone(value) {
    const digits = value.replace(/\D/g, '').slice(0, 11);
    if (!digits) return '';
    let out = '+7';
    if (digits.length > 1) out += ' (' + digits.slice(1, 4);
    if (digits.length >= 5) out += ') ' + digits.slice(4, 7);
    if (digits.length >= 8) out += '-' + digits.slice(7, 9);
    if (digits.length >= 10) out += '-' + digits.slice(9, 11);
    if (digits.length <= 1) return '+7';
    // handle paste of +7... normalize
    return out;
  }
  document.querySelectorAll('[data-phone-mask]').forEach((input) => {
    input.addEventListener('input', () => {
      const start = input.selectionStart;
      input.value = formatPhone(input.value);
      // keep cursor near end
      try {
        input.setSelectionRange(input.value.length, input.value.length);
      } catch {}
      void start;
    });
    input.addEventListener('blur', () => {
      const digits = input.value.replace(/\D/g, '');
      const errNode =
        document.getElementById(input.getAttribute('aria-describedby')) ||
        input.parentElement.querySelector('.field-error');
      if (digits.length < 11) {
        if (errNode) errNode.textContent = 'Укажите телефон в формате +7 (___) ___-__-__';
        input.classList.add('input-error');
      } else {
        if (errNode) errNode.textContent = '';
        input.classList.remove('input-error');
      }
    });
  });
  document.querySelectorAll('textarea[maxlength]').forEach((ta) => {
    const counter = ta.parentElement.querySelector('[data-char-count]');
    if (!counter) return;
    const upd = () => (counter.textContent = String(ta.value.length));
    ta.addEventListener('input', upd);
    upd();
  });
  document.querySelectorAll('[data-form="order"] input[name="name"]').forEach((inp) => {
    inp.addEventListener('blur', () => {
      const err = document.getElementById(inp.getAttribute('aria-describedby'));
      if (!err) return;
      if (inp.value.trim().length < 2) {
        err.textContent = 'Имя должно быть от 2 символов';
        inp.classList.add('input-error');
      } else {
        err.textContent = '';
        inp.classList.remove('input-error');
      }
    });
  });

  /* ---------- Order form prefill (query string) + draft restore ---------- */
  document.querySelectorAll('[data-form="order"]').forEach((form) => {
    const params = new URLSearchParams(window.location.search);
    const svc = params.get('service');
    const svcField = form.querySelector('input[name="service"]');
    if (svc && svcField && !svcField.value) svcField.value = svc;
    // draft
    const draftKey =
      'order-draft-' +
      (form.closest('#order-form')
        ? 'home'
        : form.closest('.contact-form-card')
          ? 'contacts'
          : 'service');
    try {
      const draft = JSON.parse(localStorage.getItem(draftKey) || 'null');
      if (draft) {
        ['name', 'phone', 'email', 'service', 'message'].forEach((k) => {
          const el = form.querySelector(`[name="${k}"]`);
          if (el && draft[k] && !el.value) el.value = draft[k];
        });
        const cc = form.querySelector('[data-char-count]');
        if (cc)
          cc.textContent = String(
            form.querySelector('textarea[name="message"]')?.value.length || 0
          );
      }
    } catch {}
    form.querySelectorAll('input, textarea').forEach((el) => {
      el.addEventListener('input', () => {
        try {
          const data = Object.fromEntries(new FormData(form));
          delete data.website;
          localStorage.setItem(draftKey, JSON.stringify(data));
        } catch {}
      });
    });
  });

  /* ---------- Order forms submit ---------- */
  document.querySelectorAll('[data-form="order"]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submitButton = form.querySelector('button[type="submit"]');
      const statusNode = form.querySelector('[data-form-status]');
      // client validation
      const nameEl = form.querySelector('input[name="name"]');
      const phoneEl = form.querySelector('input[name="phone"]');
      let valid = true;
      if (nameEl && nameEl.value.trim().length < 2) {
        const err = document.getElementById(nameEl.getAttribute('aria-describedby'));
        if (err) err.textContent = 'Имя должно быть от 2 символов';
        nameEl.classList.add('input-error');
        valid = false;
      }
      if (phoneEl && phoneEl.value.replace(/\D/g, '').length < 11) {
        const err = document.getElementById(phoneEl.getAttribute('aria-describedby'));
        if (err) err.textContent = 'Укажите телефон в формате +7 (___) ___-__-__';
        phoneEl.classList.add('input-error');
        valid = false;
      }
      if (!valid) {
        if (statusNode)
          statusNode.innerHTML =
            '<div class="alert alert-error"><i class="fa-solid fa-circle-exclamation"></i><span>Проверьте выделенные поля.</span></div>';
        (form.querySelector('.input-error') || nameEl || phoneEl)?.focus();
        return;
      }
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
          // focus first invalid
          if (result.errors) {
            const first = result.errors[0]?.path;
            if (first) form.querySelector(`[name="${first}"]`)?.focus();
          }
          return;
        }
        if (statusNode) {
          statusNode.innerHTML = `<div class="alert alert-success"><i class="fa-solid fa-circle-check"></i><span>${result.message}</span></div>`;
          statusNode.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        form.reset();
        form.querySelectorAll('.field-error').forEach((e) => (e.textContent = ''));
        form.querySelectorAll('.input-error').forEach((e) => e.classList.remove('input-error'));
        const cc = form.querySelector('[data-char-count]');
        if (cc) cc.textContent = '0';
        try {
          const dk =
            'order-draft-' +
            (form.closest('#order-form')
              ? 'home'
              : form.closest('.contact-form-card')
                ? 'contacts'
                : 'service');
          localStorage.removeItem(dk);
        } catch {}
      } catch {
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
