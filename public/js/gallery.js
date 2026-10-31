document.addEventListener('DOMContentLoaded', () => {
  const grid = document.querySelector('[data-gallery-grid]');
  const filterButtons = Array.from(document.querySelectorAll('[data-filter]'));
  const moreButton = document.querySelector('[data-gallery-more]');
  const statusNode = document.querySelector('[data-gallery-status]');
  const lightbox = document.getElementById('lightbox');
  const lightboxBody = document.getElementById('lightbox-body');
  const lightboxCaption = document.getElementById('lightbox-caption');
  const lightboxCounter = document.getElementById('lightbox-counter');
  const closeButton = document.getElementById('lightbox-close');
  const prevButton = document.getElementById('lightbox-prev');
  const nextButton = document.getElementById('lightbox-next');

  if (!grid) return;

  const API_URL = '/api/gallery';
  const fallbackImage = '/gallery-placeholders/sample-1.svg';

  const state = {
    total: Number.parseInt(grid.getAttribute('data-gallery-total'), 10) || 0,
    pageSize: Number.parseInt(grid.getAttribute('data-gallery-page-size'), 10) || 12,
    page: Number.parseInt(grid.getAttribute('data-gallery-page'), 10) || 1,
    filter: grid.getAttribute('data-gallery-filter') || 'all',
    query: grid.getAttribute('data-gallery-q') || '',
    loaded: 0,
    loading: false,
    failed: false,
  };

  let lightboxItems = [];
  let currentIndex = 0;
  let lastFocused = null;

  const loadedItems = () => Array.from(grid.querySelectorAll('[data-gallery-item]'));

  const updateToolbar = () => {
    if (statusNode) {
      if (state.failed) {
        statusNode.textContent = 'Не удалось догрузить работы. Обновите страницу.';
      } else if (state.total) {
        const shown = loadedItems().length;
        statusNode.textContent = `Показано ${shown} из ${state.total}`;
      } else {
        statusNode.textContent = '';
      }
    }
    if (moreButton) {
      // href — запасной путь без JS; после клиентской фильтрации его нужно пересобрать.
      const nextPage = Math.floor(state.loaded / state.pageSize) + 1;
      const params = new URLSearchParams();
      if (state.query) params.set('q', state.query);
      if (state.filter !== 'all') params.set('category', state.filter);
      if (nextPage > 1) params.set('page', String(nextPage));
      const queryString = params.toString();
      moreButton.setAttribute('href', queryString ? `/gallery?${queryString}` : '/gallery');
      moreButton.hidden = state.loaded >= state.total;
      moreButton.disabled = state.loading;
    }
  };

  const buildCard = (item) => {
    const figure = document.createElement('figure');
    figure.className = 'gallery-item';
    figure.tabIndex = 0;
    figure.setAttribute('role', 'button');

    const category = item.category || 'general';
    const title = item.title || '';
    figure.setAttribute('data-gallery-item', '');
    figure.setAttribute('data-category', category);
    figure.setAttribute('data-src', item.url || '');
    figure.setAttribute('data-mime', item.type === 'video' ? 'video' : 'image');
    figure.setAttribute('data-poster', item.thumbnail || '');
    figure.setAttribute('data-title', title);
    figure.setAttribute('aria-label', `Открыть ${title}`);

    let media;
    if (item.type === 'video') {
      media = document.createElement('video');
      media.muted = true;
      media.playsInline = true;
      media.preload = 'metadata';
      if (item.thumbnail) media.poster = item.thumbnail;
      media.src = item.url;
      const badge = document.createElement('span');
      badge.className = 'play-badge';
      const icon = document.createElement('i');
      icon.className = 'fa-solid fa-play';
      badge.append(icon);
      figure.append(media, badge);
    } else {
      media = document.createElement('img');
      media.alt = title;
      media.loading = 'lazy';
      media.src = item.url;
      figure.append(media);
    }
    watchMediaError(media);

    const caption = document.createElement('figcaption');
    const strong = document.createElement('strong');
    strong.textContent = title;
    caption.append(strong);
    if (item.description) {
      const description = document.createElement('div');
      description.className = 'text-muted';
      description.textContent = item.description;
      caption.append(description);
    }
    figure.append(caption);

    return figure;
  };

  const handleLoadFailure = (element) => {
    if (element.tagName === 'IMG') {
      if (element.getAttribute('src') === fallbackImage) return;
      element.src = fallbackImage;
    } else if (element.tagName === 'VIDEO') {
      element.poster = fallbackImage;
      element.pause();
      element.removeAttribute('src');
      element.load();
    }
  };

  const watchMediaError = (element) => {
    element.addEventListener('error', () => handleLoadFailure(element), { once: true });
  };

  const fetchPage = async (offset) => {
    const params = new URLSearchParams();
    params.set('offset', String(offset));
    params.set('limit', String(state.pageSize));
    if (state.filter !== 'all') params.set('category', state.filter);
    if (state.query) params.set('q', state.query);

    const response = await fetch(`${API_URL}?${params.toString()}`, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  };

  const loadFromApi = async (offset, { replace = false } = {}) => {
    if (state.loading) return;
    state.loading = true;
    updateToolbar();

    try {
      const data = await fetchPage(offset);
      const items = Array.isArray(data.items) ? data.items : [];
      state.failed = false;

      if (replace) {
        loadedItems().forEach((item) => item.remove());
        state.loaded = 0;
      }
      state.total = Number.parseInt(data.total, 10) || 0;

      const fragment = document.createDocumentFragment();
      items.forEach((item) => fragment.append(buildCard(item)));
      grid.append(fragment);
      state.loaded += items.length;
      // серверная первая страница может не совпадать с фильтром — тогда она перезапрошена
      if (state.loaded > state.total) state.loaded = state.total;
    } catch {
      // без JS-фолбэка сетка остаётся серверной: показываем сообщение и поднимаем кнопку обратно
      state.failed = true;
    } finally {
      state.loading = false;
      updateToolbar();
    }
  };

  const renderCounter = () => {
    if (lightboxCounter) {
      lightboxCounter.textContent = `${currentIndex + 1} / ${lightboxItems.length}`;
    }
  };

  const renderSlide = () => {
    const item = lightboxItems[currentIndex];
    if (!item || !lightboxBody) return;

    const src = item.getAttribute('data-src');
    const mime = item.getAttribute('data-mime');
    const title = item.getAttribute('data-title') || '';

    lightboxBody.replaceChildren();

    if (mime === 'video') {
      const video = document.createElement('video');
      video.controls = true;
      video.autoplay = true;
      video.playsInline = true;
      const poster = item.getAttribute('data-poster');
      if (poster) video.poster = poster;
      video.addEventListener('error', () => handleLoadFailure(video), { once: true });
      if (src) video.src = src;
      lightboxBody.append(video);
    } else {
      const image = document.createElement('img');
      image.alt = title;
      image.addEventListener(
        'error',
        () => {
          if (image.getAttribute('src') !== fallbackImage) image.src = fallbackImage;
        },
        { once: true }
      );
      image.src = src || fallbackImage;
      lightboxBody.append(image);
    }

    if (lightboxCaption) lightboxCaption.textContent = title;
    renderCounter();
  };

  const getFocusable = () =>
    Array.from(lightbox.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])')).filter(
      (el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true'
    );

  const trapFocus = (e) => {
    if (!lightbox?.classList.contains('open')) return;
    if (e.key !== 'Tab') return;
    const focusable = getFocusable();
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const openLightbox = (item) => {
    if (!lightbox) return;
    // листаем только то, что реально загружено
    lightboxItems = loadedItems();
    if (!lightboxItems.length || !lightboxItems.includes(item)) return;
    currentIndex = Math.max(lightboxItems.indexOf(item), 0);
    lastFocused = document.activeElement;
    lightbox.classList.add('open');
    document.body.style.overflow = 'hidden';
    renderSlide();
    closeButton?.focus();
    document.addEventListener('keydown', trapFocus);
  };

  const closeLightbox = () => {
    if (!lightbox) return;
    lightbox.classList.remove('open');
    if (lightboxBody) lightboxBody.replaceChildren();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', trapFocus);
    lastFocused?.focus?.();
  };

  const step = (delta) => {
    if (!lightboxItems.length) return;
    currentIndex = (currentIndex + delta + lightboxItems.length) % lightboxItems.length;
    renderSlide();
  };

  const setActiveChip = (value) => {
    filterButtons.forEach((button) => {
      const active = (button.getAttribute('data-filter') || 'all') === value;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  };

  filterButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      const value = button.getAttribute('data-filter') || 'all';
      if (value === state.filter) return;
      state.filter = value;
      setActiveChip(value);
      loadFromApi(0, { replace: true });
    });
  });

  moreButton?.addEventListener('click', (event) => {
    event.preventDefault();
    loadFromApi(state.loaded);
  });

  // Поиск остаётся серверным GET: canonical и noindex для ?q= уже настроены,
  // а догрузка по category/q работает от серверной первой страницы.

  // делегирование: карточки догружаются после навешивания обработчиков
  grid.addEventListener('click', (event) => {
    const item = event.target.closest('[data-gallery-item]');
    if (item && grid.contains(item)) openLightbox(item);
  });
  grid.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const item = event.target.closest('[data-gallery-item]');
    if (!item || !grid.contains(item)) return;
    event.preventDefault();
    openLightbox(item);
  });

  loadedItems().forEach((item) => {
    const media = item.querySelector('img, video');
    if (media) watchMediaError(media);
  });

  // серверная первая страница уже в DOM — считаем её загруженной
  state.loaded = (state.page - 1) * state.pageSize + loadedItems().length;
  updateToolbar();

  if (filterButtons.length) {
    setActiveChip(state.filter);
  }

  closeButton?.addEventListener('click', closeLightbox);
  prevButton?.addEventListener('click', () => step(-1));
  nextButton?.addEventListener('click', () => step(1));

  lightbox?.addEventListener('click', (event) => {
    if (event.target === lightbox) closeLightbox();
  });

  document.addEventListener('keydown', (event) => {
    if (!lightbox?.classList.contains('open')) return;
    if (event.key === 'Escape') closeLightbox();
    if (event.key === 'ArrowLeft') step(-1);
    if (event.key === 'ArrowRight') step(1);
  });
});
