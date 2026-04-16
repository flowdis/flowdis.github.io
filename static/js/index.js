window.HELP_IMPROVE_VIDEOJS = false;


$(document).ready(function() {
    // Check for click events on the navbar burger icon
    $(".navbar-burger").click(function() {
      // Toggle the "is-active" class on both the "navbar-burger" and the "navbar-menu"
      $(".navbar-burger").toggleClass("is-active");
      $(".navbar-menu").toggleClass("is-active");

    });

    var options = {
			slidesToScroll: 1,
			slidesToShow: 3,
			loop: true,
			infinite: true,
			autoplay: false,
			autoplaySpeed: 3000,
    }

		// Initialize all div with carousel class
    var carousels = bulmaCarousel.attach('.carousel', options);

    // Loop on each carousel initialized
    for(var i = 0; i < carousels.length; i++) {
    	// Add listener to  event
    	carousels[i].on('before:show', state => {
    		console.log(state);
    	});
    }

    // Access to bulmaCarousel instance of an element
    var element = document.querySelector('#my-element');
    if (element && element.bulmaCarousel) {
    	// bulmaCarousel instance is available as element.bulmaCarousel
    	element.bulmaCarousel.on('before-show', function(state) {
    		console.log(state);
    	});
    }

    /*var player = document.getElementById('interpolation-video');
    player.addEventListener('loadedmetadata', function() {
      $('#interpolation-slider').on('input', function(event) {
        console.log(this.value, player.duration);
        player.currentTime = player.duration / 100 * this.value;
      })
    }, false);*/

    bulmaSlider.attach();

    initPictureBoxes();
})

function initPictureBoxes() {
  // --- Singleton fullscreen backdrop (shared by all pictureboxes) ---
  var backdrop = document.createElement('div');
  backdrop.className = 'pb-fs-backdrop';
  document.body.appendChild(backdrop);
  var currentFsBox = null;
  function exitFullscreen() {
    if (!currentFsBox) return;
    if (currentFsBox._exitFs) currentFsBox._exitFs();
  }
  backdrop.addEventListener('click', exitFullscreen);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') exitFullscreen();
  });

  function initPictureBox(box) {
    var before = box.querySelector('.pb-before');
    var after  = box.querySelector('.pb-after');
    var handle = box.querySelector('.pb-handle');
    if (!after || !handle) return;

    // --- Slider state ---
    var dragging = false;
    var sliderPct = 100; // screen-space divider position (% of picturebox width)

    // --- Zoom / pan state (applied to both images equally) ---
    var scale = 1;
    var tx = 0;
    var ty = 0;
    var MIN_SCALE = 1;
    var MAX_SCALE = 6;

    // --- Auto-play state ---
    // Motion: start at MAX, ease MAX → MIN, hold (left), ease MIN → MAX, hold (right), repeat.
    var autoPlayId = null;
    var autoPlayStarted = null;
    var AUTOPLAY_MIN = 4;             // % — leftmost stop (keeps a sliver of input visible)
    var AUTOPLAY_MAX = 100;           // % — fully reveal the input
    var AUTOPLAY_MOVE_MS = 1100;      // duration of one direction sweep
    var AUTOPLAY_HOLD_LEFT_MS = 1100; // pause at the left (result fully revealed)
    var AUTOPLAY_HOLD_RIGHT_MS = 600; // pause at the right (input fully revealed)

    // Fires once per complete auto-play cycle (right→left→right→hold). Used by
    // the lang-demo carousel to auto-advance to the next prompt at the moment
    // the slider returns to MAX (input fully visible) — i.e. exactly when the
    // result image is least visible, making the swap feel seamless.
    var onIterationCallback = null;
    var currentIteration = 0;
    box._onIteration = function (cb) { onIterationCallback = cb; };

    function easeInOutCubic(t) {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    function autoPlayTick(now) {
      if (autoPlayStarted === null) {
        autoPlayStarted = now;
        currentIteration = 0;
      }
      var period = 2 * AUTOPLAY_MOVE_MS + AUTOPLAY_HOLD_LEFT_MS + AUTOPLAY_HOLD_RIGHT_MS;
      var totalT = now - autoPlayStarted;
      var iter = Math.floor(totalT / period);
      if (iter !== currentIteration) {
        currentIteration = iter;
        if (onIterationCallback) onIterationCallback();
      }
      var t = totalT % period;
      var pct;
      if (t < AUTOPLAY_MOVE_MS) {
        pct = AUTOPLAY_MAX - (AUTOPLAY_MAX - AUTOPLAY_MIN) * easeInOutCubic(t / AUTOPLAY_MOVE_MS);
      } else if (t < AUTOPLAY_MOVE_MS + AUTOPLAY_HOLD_LEFT_MS) {
        pct = AUTOPLAY_MIN;
        // The slider has just arrived at MIN at the end of a MAX→MIN sweep.
        // If the row has lost focus we use this moment as a clean stopping
        // point — the slider always finishes its current cycle before
        // freezing, so the user never sees a mid-sweep snap. Concretely:
        //   • mid MAX→MIN sweep      — finishes the sweep, halts here.
        //   • already holding at MIN — halts immediately.
        //   • mid MIN→MAX sweep      — finishes that sweep, holds at MAX,
        //                              sweeps back to MIN, halts here.
        //   • holding at MAX         — sweeps back to MIN, halts here.
        if (!inView) {
          sliderPct = AUTOPLAY_MIN;
          updateClip();
          autoPlayId = null;
          return;
        }
      } else if (t < 2 * AUTOPLAY_MOVE_MS + AUTOPLAY_HOLD_LEFT_MS) {
        var t2 = (t - AUTOPLAY_MOVE_MS - AUTOPLAY_HOLD_LEFT_MS) / AUTOPLAY_MOVE_MS;
        pct = AUTOPLAY_MIN + (AUTOPLAY_MAX - AUTOPLAY_MIN) * easeInOutCubic(t2);
      } else {
        pct = AUTOPLAY_MAX;
      }
      sliderPct = pct;
      updateClip();
      autoPlayId = requestAnimationFrame(autoPlayTick);
    }

    function startAutoPlay() {
      if (autoPlayDisabled) return;
      // Don't run animation frames for sliders the user can't actually see.
      // The active-row picker in initPictureBoxes() flips `inView` on/off so
      // only the single row centered in the viewport autoplays.
      if (!inView) return;
      if (autoPlayId !== null) return;

      // Pick the cycle phase to resume at based on which "stable pose" the
      // slider is parked nearer to. Two cases:
      //   • Closer to MIN (4%, "result fully revealed") — typical after a
      //     previous cycle wound down to MIN. Snap to MIN exactly and resume
      //     at the start of the hold-at-MIN phase, so the slider briefly
      //     settles at the showcase pose, then sweeps up to MAX, holds, and
      //     sweeps back, and repeats.
      //   • Closer to MAX (100%) — the initial state on first activation.
      //     Snap to MAX and start a fresh cycle from t=0, which is the
      //     natural MAX→MIN sweep.
      currentIteration = 0;
      if (Math.abs(sliderPct - AUTOPLAY_MIN) < Math.abs(sliderPct - AUTOPLAY_MAX)) {
        sliderPct = AUTOPLAY_MIN;
        updateClip();
        autoPlayStarted = performance.now() - AUTOPLAY_MOVE_MS;
      } else {
        sliderPct = AUTOPLAY_MAX;
        updateClip();
        autoPlayStarted = null;
      }
      autoPlayId = requestAnimationFrame(autoPlayTick);
    }

    var slideAnimId = null;
    // Once the user (or any external control) has stopped auto-play, we don't
    // want it to silently resume — for example when the after-image's src is
    // swapped by the lang-demo carousel and the resulting `load` event re-runs
    // initialClip(). This flag latches "off" forever once tripped.
    var autoPlayDisabled = false;

    // Viewport-driven pause state. Distinct from `autoPlayDisabled` (which is
    // permanent and user-driven): `inView` is non-latching and toggles as the
    // active-row picker decides which row of pictureboxes the user is
    // looking at right now.
    var inView = false;

    // When the picturebox loses "active row" status we don't snap it or tween
    // it — we let autoPlayTick keep ticking and rely on its in-loop halt
    // check (when it naturally arrives at AUTOPLAY_MIN) to stop the cycle.
    // That way the slider always finishes its current movement at the normal
    // sweep speed before freezing, regardless of which phase it was in.
    function pauseAutoPlay() {
      // The user has interacted (drag/zoom/dblclick/prev-next/dot tap) —
      // autoPlayDisabled latches and stopAutoPlay() has already cancelled
      // the rAF. Nothing left to do.
      if (autoPlayDisabled) return;
      // Otherwise: don't touch the rAF loop. autoPlayTick checks `inView`
      // every frame and will halt itself at the next MIN it crosses.
    }

    // Called by the active-row picker in initPictureBoxes(). Only autoplay
    // while this picturebox is part of the row the user is centered on.
    box._setInView = function (v) {
      v = !!v;
      if (v === inView) return;
      inView = v;
      if (v) startAutoPlay();
      else pauseAutoPlay();
    };

    function stopAutoPlay() {
      autoPlayDisabled = true;
      if (autoPlayId !== null) {
        cancelAnimationFrame(autoPlayId);
        autoPlayId = null;
      }
      if (slideAnimId !== null) {
        cancelAnimationFrame(slideAnimId);
        slideAnimId = null;
      }
    }

    // One-shot tween of sliderPct to a target value (used by external
    // controls like the lang-demo prev/next buttons). Cancels auto-play and
    // any in-flight tween, then leaves the slider parked at the target.
    function slideTo(targetPct, durationMs) {
      stopAutoPlay();
      var startPct = sliderPct;
      var startTime = null;
      function step(now) {
        if (startTime === null) startTime = now;
        var t = Math.min(1, (now - startTime) / durationMs);
        var k = easeInOutCubic(t);
        sliderPct = startPct + (targetPct - startPct) * k;
        updateClip();
        if (t < 1) {
          slideAnimId = requestAnimationFrame(step);
        } else {
          slideAnimId = null;
        }
      }
      slideAnimId = requestAnimationFrame(step);
    }
    box._slideTo = slideTo;

    // Recompute clip-path so the visible clip boundary sits at sliderPct% of the
    // picturebox, regardless of current zoom/pan. The clip-path operates in the
    // image's local coord system; we invert the transform to compensate.
    function updateClip() {
      var rect = box.getBoundingClientRect();
      var boxWidth = rect.width || 1;
      var localPct = (sliderPct - (tx / boxWidth) * 100) / scale;
      localPct = Math.max(0, Math.min(100, localPct));
      var afterClip  = 'inset(0 0 0 ' + localPct + '%)';
      var beforeClip = 'inset(0 ' + (100 - localPct) + '% 0 0)';
      after.style.clipPath = afterClip;
      after.style.webkitClipPath = afterClip;
      if (before) {
        before.style.clipPath = beforeClip;
        before.style.webkitClipPath = beforeClip;
      }
      handle.style.left = sliderPct + '%';
    }

    function applyTransform() {
      var t = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
      if (before) {
        before.style.transformOrigin = '0 0';
        before.style.transform = t;
      }
      after.style.transformOrigin = '0 0';
      after.style.transform = t;
      if (scale > 1) {
        box.classList.add('is-zoomed');
      } else {
        box.classList.remove('is-zoomed');
      }
      updateClip();
    }

    function clampPan() {
      var rect = box.getBoundingClientRect();
      var w = rect.width;
      var h = rect.height;
      var maxTx = 0;
      var maxTy = 0;
      var minTx = w - w * scale;
      var minTy = h - h * scale;
      if (tx > maxTx) tx = maxTx;
      if (ty > maxTy) ty = maxTy;
      if (tx < minTx) tx = minTx;
      if (ty < minTy) ty = minTy;
      if (scale <= 1) { tx = 0; ty = 0; }
    }

    function zoomAt(cx, cy, factor) {
      var newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale * factor));
      if (newScale === scale) return;
      var actual = newScale / scale;
      tx = cx - (cx - tx) * actual;
      ty = cy - (cy - ty) * actual;
      scale = newScale;
      clampPan();
      applyTransform();
    }

    function resetZoom() {
      scale = 1;
      tx = 0;
      ty = 0;
      applyTransform();
    }

    // --- Slider drag / pan state ---
    // mode: null | 'slider' | 'pan'
    var mode = null;
    var panStartX = 0, panStartY = 0;
    var panStartTx = 0, panStartTy = 0;

    function setPosition(clientX) {
      var rect = box.getBoundingClientRect();
      var x = clientX - rect.left;
      sliderPct = Math.max(0, Math.min(100, (x / rect.width) * 100));
      updateClip();
    }

    // Treat a click as a "handle click" if it's within ~24px of the handle line.
    function isNearHandle(clientX) {
      var rect = box.getBoundingClientRect();
      var handleX = rect.left + (sliderPct / 100) * rect.width;
      return Math.abs(clientX - handleX) <= 24;
    }

    function onDown(e) {
      if (e.touches && e.touches.length >= 2) return;
      var point = e.touches ? e.touches[0] : e;
      if (isNearHandle(point.clientX)) {
        // Drag the slider — only when actually grabbing the handle.
        stopAutoPlay();
        mode = 'slider';
        setPosition(point.clientX);
        dragging = true;
        e.preventDefault();
      } else if (scale > 1) {
        // Zoomed in: drag elsewhere = pan.
        stopAutoPlay();
        mode = 'pan';
        panStartX = point.clientX;
        panStartY = point.clientY;
        panStartTx = tx;
        panStartTy = ty;
        box.style.cursor = 'grabbing';
        dragging = true;
        e.preventDefault();
      }
      // Otherwise: not on handle and not zoomed → let the browser handle it
      // (so the page can scroll on mobile, text can be selected, etc.).
    }

    function onMove(e) {
      if (!dragging) return;
      if (e.touches && e.touches.length >= 2) { dragging = false; return; }
      var point = e.touches ? e.touches[0] : e;
      if (mode === 'slider') {
        setPosition(point.clientX);
      } else if (mode === 'pan') {
        tx = panStartTx + (point.clientX - panStartX);
        ty = panStartTy + (point.clientY - panStartY);
        clampPan();
        applyTransform();
      }
    }

    function onUp() {
      dragging = false;
      mode = null;
      box.style.cursor = '';
    }

    box.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    // --- Pinch-to-zoom on trackpad (desktop) ---
    // A trackpad pinch arrives as a `wheel` event with a synthetic
    // `ctrlKey: true`; a regular two-finger scroll or mouse-wheel turn
    // arrives with `ctrlKey: false`. We only intercept the pinch case so
    // ordinary scrolling over the picturebox lets the page scroll naturally.
    box.addEventListener('wheel', function (e) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      stopAutoPlay();
      var rect = box.getBoundingClientRect();
      var cx = e.clientX - rect.left;
      var cy = e.clientY - rect.top;
      var factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      zoomAt(cx, cy, factor);
    }, { passive: false });

    // --- Double-click resets zoom ---
    box.addEventListener('dblclick', function (e) {
      e.preventDefault();
      stopAutoPlay();
      resetZoom();
    });

    // --- Touch: single-finger drags slider, two-finger pinch zooms ---
    var pinchStartDist = null;
    var pinchStartScale = 1;
    var pinchCenter = null;
    var lastTap = 0;

    box.addEventListener('touchstart', function (e) {
      if (e.touches.length === 2) {
        stopAutoPlay();
        dragging = false;
        var t1 = e.touches[0];
        var t2 = e.touches[1];
        pinchStartDist = Math.hypot(
          t2.clientX - t1.clientX,
          t2.clientY - t1.clientY
        );
        pinchStartScale = scale;
        var rect = box.getBoundingClientRect();
        pinchCenter = {
          x: (t1.clientX + t2.clientX) / 2 - rect.left,
          y: (t1.clientY + t2.clientY) / 2 - rect.top
        };
        e.preventDefault();
        return;
      }
      // Double-tap-to-reset
      var now = Date.now();
      if (now - lastTap < 300) {
        stopAutoPlay();
        resetZoom();
        lastTap = 0;
        e.preventDefault();
        return;
      }
      lastTap = now;
      onDown(e);
    }, { passive: false });

    box.addEventListener('touchmove', function (e) {
      if (e.touches.length === 2 && pinchStartDist) {
        var t1 = e.touches[0];
        var t2 = e.touches[1];
        var d = Math.hypot(
          t2.clientX - t1.clientX,
          t2.clientY - t1.clientY
        );
        var desiredScale = Math.max(
          MIN_SCALE,
          Math.min(MAX_SCALE, pinchStartScale * d / pinchStartDist)
        );
        var actual = desiredScale / scale;
        tx = pinchCenter.x - (pinchCenter.x - tx) * actual;
        ty = pinchCenter.y - (pinchCenter.y - ty) * actual;
        scale = desiredScale;
        clampPan();
        applyTransform();
        e.preventDefault();
        return;
      }
      onMove(e);
    }, { passive: false });

    box.addEventListener('touchend', function (e) {
      if (e.touches.length < 2) {
        pinchStartDist = null;
        pinchCenter = null;
      }
      onUp();
    });

    // --- Fullscreen view ---
    var EXPAND_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 9 4 4 9 4"/><polyline points="15 4 20 4 20 9"/><polyline points="20 15 20 20 15 20"/><polyline points="9 20 4 20 4 15"/></svg>';
    var CLOSE_SVG  = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';

    var fsBtn = document.createElement('button');
    fsBtn.type = 'button';
    fsBtn.className = 'pb-fs-btn';
    fsBtn.setAttribute('aria-label', 'View fullscreen');
    fsBtn.innerHTML = EXPAND_SVG;
    box.appendChild(fsBtn);

    var fsClose = document.createElement('button');
    fsClose.type = 'button';
    fsClose.className = 'pb-fs-close';
    fsClose.setAttribute('aria-label', 'Close fullscreen');
    fsClose.innerHTML = CLOSE_SVG;
    box.appendChild(fsClose);

    function enterFullscreen() {
      if (currentFsBox && currentFsBox !== box && currentFsBox._exitFs) {
        currentFsBox._exitFs();
      }
      stopAutoPlay();
      resetZoom();
      sliderPct = 30;
      box.classList.add('is-fullscreen');
      document.body.classList.add('has-pb-fullscreen');
      currentFsBox = box;
      requestAnimationFrame(updateClip);
    }
    function exitFs() {
      box.classList.remove('is-fullscreen');
      document.body.classList.remove('has-pb-fullscreen');
      resetZoom();
      currentFsBox = null;
      requestAnimationFrame(updateClip);
    }
    box._exitFs = exitFs;

    // Stop the underlying drag/pan handlers from receiving the click on the buttons.
    function swallow(e) { e.stopPropagation(); }
    fsBtn.addEventListener('mousedown', swallow);
    fsBtn.addEventListener('touchstart', swallow, { passive: true });
    fsClose.addEventListener('mousedown', swallow);
    fsClose.addEventListener('touchstart', swallow, { passive: true });

    fsBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      enterFullscreen();
    });
    fsClose.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      exitFs();
    });

    // --- Zoom in / out buttons (semitransparent, fade in on hover) ---
    var ZOOM_IN_SVG  = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>';
    var ZOOM_OUT_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>';

    var zoomInBtn = document.createElement('button');
    zoomInBtn.type = 'button';
    zoomInBtn.className = 'pb-zoom pb-zoom-in';
    zoomInBtn.setAttribute('aria-label', 'Zoom in');
    zoomInBtn.innerHTML = ZOOM_IN_SVG;
    box.appendChild(zoomInBtn);

    var zoomOutBtn = document.createElement('button');
    zoomOutBtn.type = 'button';
    zoomOutBtn.className = 'pb-zoom pb-zoom-out';
    zoomOutBtn.setAttribute('aria-label', 'Zoom out');
    zoomOutBtn.innerHTML = ZOOM_OUT_SVG;
    box.appendChild(zoomOutBtn);

    function zoomFromCenter(factor) {
      stopAutoPlay();
      var rect = box.getBoundingClientRect();
      zoomAt(rect.width / 2, rect.height / 2, factor);
    }

    zoomInBtn.addEventListener('mousedown', swallow);
    zoomInBtn.addEventListener('touchstart', swallow, { passive: true });
    zoomOutBtn.addEventListener('mousedown', swallow);
    zoomOutBtn.addEventListener('touchstart', swallow, { passive: true });

    // Two fast clicks on a zoom button generate a `dblclick` event that
    // bubbles up to the picturebox and triggers its dblclick→resetZoom
    // handler — making the second click look like it "zoomed out". Swallow
    // dblclick on the buttons so it never reaches the box.
    function swallowDblClick(e) {
      e.stopPropagation();
      e.preventDefault();
    }
    zoomInBtn.addEventListener('dblclick', swallowDblClick);
    zoomOutBtn.addEventListener('dblclick', swallowDblClick);

    zoomInBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      zoomFromCenter(1.5);
    });
    zoomOutBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      zoomFromCenter(1 / 1.5);
    });

    // Keep the slider aligned if the viewport is resized while in fullscreen.
    window.addEventListener('resize', function () {
      if (box.classList.contains('is-fullscreen')) updateClip();
    });

    // Apply the initial 50/50 clip and start the auto-play loop.
    // Run after layout is ready (so getBoundingClientRect returns a non-zero
    // width) and re-run after each image loads (in case dimensions change
    // once the GIF/PNG is decoded). Auto-play stops on any user interaction.
    function initialClip() {
      updateClip();
      if (autoPlayId === null) startAutoPlay();
    }
    requestAnimationFrame(initialClip);
    window.addEventListener('load', initialClip);
    [before, after].forEach(function (img) {
      if (!img) return;
      if (img.complete) initialClip();
      else img.addEventListener('load', initialClip);
    });
  }

  document.querySelectorAll('.picturebox').forEach(initPictureBox);

  // Active-row picker: at any given scroll position, exactly one *row* of
  // pictureboxes autoplays — the row whose vertical center is closest to
  // the viewport center. Pictureboxes that lose active-row status keep
  // running their cycle until autoPlayTick naturally arrives at MIN, then
  // halt there — so the slider always finishes its current movement at the
  // normal sweep speed and parks at the "result fully revealed" pose.
  //
  // "Row" is determined dynamically from current layout via getBoundingClientRect:
  // the picturebox closest to viewport center is the winner; every other
  // picturebox whose vertical center is within ±half-the-winner's-height
  // counts as the same visual row. That correctly handles both the 2-up
  // desktop grid (both columns of one row play together) and the 1-up
  // mobile stack (only the single centered card plays).
  //
  // This does NOT override the user-interaction pause: once a user touches /
  // drags / zooms / clicks a slider, `autoPlayDisabled` latches inside that
  // picturebox and visibility changes never resume it.
  var allBoxes = Array.prototype.slice.call(document.querySelectorAll('.picturebox'));
  if (allBoxes.length) {
    var pendingActiveFrame = null;
    function scheduleActiveRowUpdate() {
      if (pendingActiveFrame !== null) return;
      pendingActiveFrame = requestAnimationFrame(function () {
        pendingActiveFrame = null;
        updateActiveRow();
      });
    }

    function updateActiveRow() {
      var n = allBoxes.length;
      var vpHeight = window.innerHeight;
      var vpCenter = vpHeight / 2;

      var rects = new Array(n);
      for (var i = 0; i < n; i++) {
        rects[i] = allBoxes[i].getBoundingClientRect();
      }

      // Find the on-screen picturebox whose vertical center is closest to
      // the viewport center. Off-screen boxes are skipped.
      var bestIdx = -1;
      var bestDist = Infinity;
      for (var j = 0; j < n; j++) {
        var r = rects[j];
        if (r.bottom <= 0 || r.top >= vpHeight) continue;
        var c = (r.top + r.bottom) / 2;
        var d = Math.abs(c - vpCenter);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = j;
        }
      }

      // No picturebox is on-screen at all — pause everything.
      var rowCenter = bestIdx >= 0 ? (rects[bestIdx].top + rects[bestIdx].bottom) / 2 : 0;
      var rowTol    = bestIdx >= 0 ? rects[bestIdx].height * 0.5 : 0;

      for (var k = 0; k < n; k++) {
        var inRow = false;
        if (bestIdx >= 0) {
          var center = (rects[k].top + rects[k].bottom) / 2;
          inRow = Math.abs(center - rowCenter) <= rowTol;
        }
        if (typeof allBoxes[k]._setInView === 'function') {
          allBoxes[k]._setInView(inRow);
        }
      }
    }

    window.addEventListener('scroll', scheduleActiveRowUpdate, { passive: true });
    window.addEventListener('resize', scheduleActiveRowUpdate);
    window.addEventListener('load', scheduleActiveRowUpdate);
    scheduleActiveRowUpdate();
  }

  initLangDemo();
}

// Text-guided segmentation demo: a single input image whose result swaps
// based on the currently selected text prompt. Prev/Next cycle through the
// prompt list; the slider/zoom/fullscreen behavior comes from the standard
// picturebox machinery initialized above.
//
// Prompt lists are keyed by the demo's data-lang-base path so each demo can
// declare its own folder and reuse the carousel logic.
var LANG_PROMPTS = {
  './static/images/lang/2/': [
    { text: 'A book and a hat on a white textured towel.', file: 'A book and a hat on a white textured towel.png' },
    { text: 'A book and sunglasses.',                      file: 'A book and sunglasses.png' },
    { text: 'Sunglasses.',                                 file: 'Sunglasses.png' },
    { text: 'A hat.',                                      file: 'A hat.png' },
    { text: '(empty prompt)',                              file: 'empty.png', empty: true }
  ],
  './static/images/lang/1/': [
    { text: 'A person and a skateboard.',                  file: 'A person and a skateboard.png' },
    { text: 'A red skateboard with green wheels.',         file: 'A red skateboard with green wheels.png' },
    { text: 'A person.',                                   file: 'A person.png' }
  ]
};

// Background image preloader for the language-guided demo.
//
// Result PNGs in this demo are large (several MB each), so on slow connections
// swapping images on prev/next click can stall noticeably. We can't just queue
// all of them in parallel — that would just split the (already small) bandwidth
// N ways and make the *first* needed image take N× longer. Instead we maintain
// a single priority queue and fetch one image at a time, at low priority, with
// each demo bumping its expected-next images to the front whenever the user
// navigates.
//
// Each fetched image is stored as an in-memory `blob:` URL. When the demo sets
// `<img src=...>`, it goes through `langPreloader.resolve(url)` which returns
// the blob URL if available — that guarantees zero network on subsequent
// navigations regardless of HTTP cache headers (so it works the same on a bare
// local dev server as on GitHub Pages, even with DevTools "Disable cache" on).
var langPreloader = (function () {
  var blobUrl  = {};   // original url -> blob: url (if successfully fetched)
  var done     = {};   // original url -> true once we've finished trying
  var queue    = [];
  var inFlight = false;
  var started  = false;

  function finish(url, blob) {
    done[url] = true;
    if (blob) blobUrl[url] = URL.createObjectURL(blob);
    inFlight = false;
    pump();
  }

  function fetchOne(url) {
    inFlight = true;
    // Prefer fetch() so we get a real Blob we can pin in JS memory.
    if (typeof fetch === 'function' && typeof URL.createObjectURL === 'function') {
      // `priority: 'low'` is honored by Chromium/WebKit and ignored elsewhere.
      // Keeps the preload from competing with user-initiated requests.
      var init = { credentials: 'same-origin', priority: 'low' };
      fetch(url, init)
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
        .then(function (blob) { finish(url, blob); })
        .catch(function () {
          // Network/CORS failure — fall back to a plain Image preload so the
          // resource at least lands in the HTTP cache.
          var img = new Image();
          img.onload = img.onerror = function () { finish(url, null); };
          img.src = url;
        });
    } else {
      var img = new Image();
      img.onload = img.onerror = function () { finish(url, null); };
      img.src = url;
    }
  }

  function pump() {
    if (inFlight) return;
    while (queue.length) {
      var url = queue.shift();
      if (done[url]) continue;
      fetchOne(url);
      return;
    }
  }

  function schedule() {
    if (started) { pump(); return; }
    started = true;
    // Defer the first fetch until the browser has had a chance to paint and
    // load critical resources, so we don't compete with above-the-fold content.
    var kick = function () { pump(); };
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(kick, { timeout: 2000 });
    } else {
      setTimeout(kick, 600);
    }
  }

  return {
    // Move `urls` to the front of the queue (in the given order), de-duped
    // against what we've already finished or queued. Anything already pending
    // but not in `urls` gets pushed behind these.
    prioritize: function (urls) {
      var seen = {};
      var front = [];
      for (var i = 0; i < urls.length; i++) {
        var u = urls[i];
        if (done[u] || seen[u]) continue;
        seen[u] = true;
        front.push(u);
      }
      var rest = [];
      for (var j = 0; j < queue.length; j++) {
        var v = queue[j];
        if (!seen[v] && !done[v]) rest.push(v);
      }
      queue = front.concat(rest);
      schedule();
    },
    // Returns the in-memory blob: URL for `url` if we've fetched it, otherwise
    // the original `url` (so the browser will fetch normally — possibly from
    // its own HTTP cache).
    resolve: function (url) { return blobUrl[url] || url; },
    isLoaded: function (url) { return !!blobUrl[url]; }
  };
})();

function initLangDemo() {
  document.querySelectorAll('.lang-demo').forEach(initOneLangDemo);
}

function initOneLangDemo(demo) {
  var base = demo.getAttribute('data-lang-base') || '';
  var prompts = LANG_PROMPTS[base];
  if (!prompts || !prompts.length) return;

  var textEl    = demo.querySelector('.lang-prompt-text');
  var textInner = demo.querySelector('.lang-prompt-text-inner');
  var prevBtn   = demo.querySelector('.lang-prev');
  var nextBtn   = demo.querySelector('.lang-next');
  var afterImg  = demo.querySelector('.pb-after');
  var pbox      = demo.querySelector('.picturebox');
  if (!textEl || !textInner || !prevBtn || !nextBtn || !afterImg) return;

  var idx = 0;
  for (var i = 0; i < prompts.length; i++) {
    if (afterImg.getAttribute('src').indexOf(prompts[i].file) !== -1) { idx = i; break; }
  }

  // Build a priority list of URLs to preload, ordered by distance from the
  // currently-shown prompt: idx+1, idx-1, idx+2, idx-2, ..., then the current
  // prompt itself last. We *do* still preload the current image (lowest
  // priority) even though the <img> tag already loaded it, because we want a
  // blob: URL for it too — so navigating back to it later is also a pure
  // memory swap.
  function orderedUrls() {
    var n = prompts.length;
    var out = [];
    var added = {};
    for (var d = 1; d <= n; d++) {
      var fwd = (idx + d) % n;
      var bwd = (idx - d + n) % n;
      if (fwd !== idx && !added[fwd]) { out.push(base + prompts[fwd].file); added[fwd] = true; }
      if (bwd !== idx && !added[bwd]) { out.push(base + prompts[bwd].file); added[bwd] = true; }
      if (out.length >= n - 1) break;
    }
    if (!added[idx]) out.push(base + prompts[idx].file);
    return out;
  }
  langPreloader.prioritize(orderedUrls());

  // Reserve enough vertical space for the *longest* prompt at the current
  // viewport width, so the prompt bar (and the slider below it) doesn't
  // shift up/down when the user navigates to a longer/shorter prompt that
  // wraps onto more or fewer lines.
  function measureTallestPromptHeight() {
    var probe = document.createElement('span');
    probe.className = 'lang-prompt-text-inner lang-prompt-text-measure';
    textEl.appendChild(probe);
    var max = 0;
    for (var i = 0; i < prompts.length; i++) {
      probe.textContent = prompts[i].text;
      probe.classList.toggle('is-empty', !!prompts[i].empty);
      var h = probe.offsetHeight;
      if (h > max) max = h;
    }
    textEl.removeChild(probe);
    return max;
  }
  function applyMinHeight() {
    var h = measureTallestPromptHeight();
    if (h > 0) textEl.style.minHeight = h + 'px';
  }
  applyMinHeight();
  // Re-measure on viewport changes — wrapping behaviour depends on width.
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(applyMinHeight, 120);
  });

  function setText(p) {
    textInner.textContent = p.text;
    textInner.classList.toggle('is-empty', !!p.empty);
  }

  function transitionTo(p, direction) {
    // Remove any leftover ghost(s) from rapid clicks.
    textEl.querySelectorAll('.lang-prompt-text-inner').forEach(function (el) {
      if (el !== textInner) el.remove();
    });

    var ghost = textInner.cloneNode(true);
    ghost.classList.add('is-ghost');
    textEl.appendChild(ghost);

    setText(p);

    var dur = '380ms';
    var easing = 'cubic-bezier(0.4, 0, 0.2, 1)';
    var dist = (textEl.offsetWidth || 200) + 'px';

    ghost.style.setProperty('--slide-dist', dist);
    textInner.style.setProperty('--slide-dist', dist);

    var ghostAnim = direction > 0 ? 'lang-text-out-left' : 'lang-text-out-right';
    var innerAnim = direction > 0 ? 'lang-text-in-from-right' : 'lang-text-in-from-left';

    // Reset textInner so the same animation re-runs on subsequent clicks.
    textInner.style.animation = 'none';
    /* force reflow so the animation restarts cleanly */
    void textInner.offsetWidth;
    textInner.style.animation = innerAnim + ' ' + dur + ' ' + easing + ' both';

    ghost.style.animation = ghostAnim + ' ' + dur + ' ' + easing + ' forwards';
    ghost.addEventListener('animationend', function () { ghost.remove(); });
  }

  // Pagination dots: one per prompt. Shows how many prompts there are,
  // highlights the current one in the page accent colour, and lets the
  // user jump directly to any prompt with a tap.
  var dotsEl = document.createElement('div');
  dotsEl.className = 'lang-dots';
  var dots = [];
  for (var k = 0; k < prompts.length; k++) {
    var dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'lang-dot';
    dot.setAttribute('aria-label', 'Go to prompt ' + (k + 1) + ' of ' + prompts.length);
    (function (target) {
      dot.addEventListener('click', function () { goToIdx(target); });
    })(k);
    dotsEl.appendChild(dot);
    dots.push(dot);
  }
  demo.appendChild(dotsEl);
  function updateDots() {
    for (var k = 0; k < dots.length; k++) {
      var active = (k === idx);
      dots[k].classList.toggle('is-active', active);
      if (active) dots[k].setAttribute('aria-current', 'true');
      else dots[k].removeAttribute('aria-current');
    }
  }

  // Shared "render the new idx" path used by next/prev clicks, dot taps,
  // and the slider's iteration callback.
  function applyIdxChange(direction) {
    transitionTo(prompts[idx], direction);
    // resolve() returns a blob: URL if the preloader already has the image
    // in memory; otherwise the original URL (which the browser will fetch
    // normally, possibly hitting its own HTTP cache).
    afterImg.src = langPreloader.resolve(base + prompts[idx].file);
    // Re-prioritize so the next expected images jump to the front of the
    // background download queue.
    langPreloader.prioritize(orderedUrls());
    updateDots();
  }

  function go(delta) {
    idx = (idx + delta + prompts.length) % prompts.length;
    applyIdxChange(delta > 0 ? 1 : -1);
    if (pbox && pbox._slideTo) pbox._slideTo(4, 600);
  }

  function goToIdx(target) {
    if (target === idx) return;
    // Pick the shorter direction around the cycle so the carousel
    // animation reflects the user's spatial intent (forward dot → slide-in
    // from the right, backward dot → slide-in from the left).
    var n = prompts.length;
    var diff = ((target - idx) % n + n) % n;     // 0..n-1
    var direction = (diff <= n / 2) ? 1 : -1;
    idx = target;
    applyIdxChange(direction);
    if (pbox && pbox._slideTo) pbox._slideTo(4, 600);
  }

  prevBtn.addEventListener('click', function () { go(-1); });
  nextBtn.addEventListener('click', function () { go(1); });

  // Auto-advance to the next prompt at the end of each slider cycle. Unlike
  // a click on next/prev, this does NOT touch the slider — the slider is
  // already at MAX (input fully visible) at the iteration boundary, so the
  // image swap happens while the result is hidden, then the next cycle
  // sweeps right→left to reveal the new result.
  //
  // The picturebox auto-play has a latching `autoPlayDisabled` flag that's
  // tripped by any user interaction (drag, zoom, dblclick, prev/next click,
  // dot tap). Once tripped, the requestAnimationFrame loop stops, so this
  // callback simply stops being called — auto-advance halts automatically.
  if (pbox && pbox._onIteration) {
    pbox._onIteration(function () {
      idx = (idx + 1) % prompts.length;
      applyIdxChange(1);
    });
  }

  setText(prompts[idx]);
  afterImg.src = langPreloader.resolve(base + prompts[idx].file);
  updateDots();
}
