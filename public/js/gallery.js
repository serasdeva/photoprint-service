document.addEventListener('DOMContentLoaded', () => {
  const filterButtons = Array.from(document.querySelectorAll('[data-filter]'));
  const allItems = Array.from(document.querySelectorAll('[data-gallery-item]'));
  const lightbox = document.getElementById('lightbox');
  const lightboxBody = document.getElementById('lightbox-body');
  const lightboxCaption = document.getElementById('lightbox-caption');
  const lightboxCounter = document.getElementById('lightbox-counter');
  const closeButton = document.getElementById('lightbox-close');
  const prevButton = document.getElementById('lightbox-prev');
  const nextButton = document.getElementById('lightbox-next');

  let visibleItems = allItems;
  let currentIndex = 0;
  let lastFocused = null;
  const fallbackImage = '/gallery-placeholders/sample-1.svg';
  const PAGE_SIZE = 12;
  const moreButton = document.querySelector('[data-gallery-more]');
  const statusNode = document.querySelector('[data-gallery-status]');
  let activeFilter = 'all';
  let shownCount = PAGE_SIZE;

  const matchesFilter = (item) =>
    activeFilter === 'all' || item.getAttribute('data-category') === activeFilter;

  const renderGallery = () => {
    const matched = allItems.filter(matchesFilter);
    let matchedIndex = 0;

    allItems.forEach((item) => {
      if (!matchesFilter(item)) {
        item.classList.add('is-hidden');
        return;
      }
      const withinWindow = matchedIndex < shownCount;
      item.classList.toggle('is-hidden', !withinWindow);
      matchedIndex += 1;
    });

    if (statusNode) {
      statusNode.textContent = matched.length
        ? `Показано ${Math.min(shownCount, matched.length)} из ${matched.length}`
        : '';
    }
    if (moreButton) {
      moreButton.hidden = shownCount >= matched.length;
    }
  };

  const handleMediaError = (element) => {
    if (element.tagName === 'IMG') {
      if (element.getAttribute('src') === fallbackImage) return;
      element.addEventListener(
        'error',
        () => {
          element.src = fallbackImage;
        },
        { once: true }
      );
      if (element.complete && element.naturalWidth === 0) {
        element.src = fallbackImage;
      }
    } else if (element.tagName === 'VIDEO') {
      element.addEventListener(
        'error',
        () => {
          element.poster = fallbackImage;
          element.pause();
          element.removeAttribute('src');
          element.load();
        },
        { once: true }
      );
    }
  };

  const renderCounter = () => {
    if (lightboxCounter) {
      lightboxCounter.textContent = `${currentIndex + 1} / ${visibleItems.length}`;
    }
  };

  const renderSlide = () => {
    const item = visibleItems[currentIndex];
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
      handleMediaError(video);
      if (src) video.src = src;
      lightboxBody.append(video);
    } else {
      const image = document.createElement('img');
      image.alt = title;
      handleMediaError(image);
      image.src = src || fallbackImage;
      lightboxBody.append(image);
    }

    if (lightboxCaption) lightboxCaption.textContent = title;
    renderCounter();
  };

  const openLightbox = (item) => {
    if (!lightbox) return;
    visibleItems = allItems.filter(matchesFilter);
    currentIndex = Math.max(visibleItems.indexOf(item), 0);
    lastFocused = document.activeElement;
    lightbox.classList.add('open');
    document.body.style.overflow = 'hidden';
    renderSlide();
    closeButton?.focus();
  };

  const closeLightbox = () => {
    if (!lightbox) return;
    lightbox.classList.remove('open');
    if (lightboxBody) lightboxBody.innerHTML = '';
    document.body.style.overflow = '';
    lastFocused?.focus?.();
  };

  const step = (delta) => {
    if (!visibleItems.length) return;
    currentIndex = (currentIndex + delta + visibleItems.length) % visibleItems.length;
    renderSlide();
  };

  if (filterButtons.length && allItems.length) {
    filterButtons.forEach((button) => {
      button.addEventListener('click', () => {
        activeFilter = button.getAttribute('data-filter') || 'all';
        shownCount = PAGE_SIZE;
        filterButtons.forEach((item) => item.classList.toggle('active', item === button));
        renderGallery();
      });
    });
  }

  moreButton?.addEventListener('click', () => {
    shownCount += PAGE_SIZE;
    renderGallery();
  });

  if (allItems.length) {
    renderGallery();
  }

  allItems.forEach((item) => {
    const thumbnail = item.querySelector('img, video');
    if (thumbnail) handleMediaError(thumbnail);

    item.addEventListener('click', () => openLightbox(item));
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openLightbox(item);
      }
    });
  });

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
