(function() {
    'use strict';

    const BASE_WIDTH = 1280;
    const BASE_HEIGHT = 720;

    const state = {
        slides: [],
        activeSlideId: null,
        selectedElementId: null,
        drag: null,
        resize: null,
        activePointerId: null,
        toastTimer: null
    };

    const els = {
        canvas: document.getElementById('slideCanvas'),
        slidesList: document.getElementById('slidesList'),
        layersList: document.getElementById('layersList'),
        addTextBtn: document.getElementById('addTextBtn'),
        addImageBtn: document.getElementById('addImageBtn'),
        imageUploadInput: document.getElementById('imageUploadInput'),
        addSlideBtn: document.getElementById('addSlideBtn'),
        addSlideMiniBtn: document.getElementById('addSlideMiniBtn'),
        previewBtn: document.getElementById('previewBtn'),
        saveDeckBtn: document.getElementById('saveDeckBtn'),
        emptyProperties: document.getElementById('emptyProperties'),
        propertiesPanel: document.getElementById('propertiesPanel'),
        textProps: document.getElementById('textProps'),
        imageProps: document.getElementById('imageProps'),
        propX: document.getElementById('propX'),
        propY: document.getElementById('propY'),
        propText: document.getElementById('propText'),
        propFontSize: document.getElementById('propFontSize'),
        propColor: document.getElementById('propColor'),
        propBold: document.getElementById('propBold'),
        alignLeft: document.getElementById('alignLeft'),
        alignCenter: document.getElementById('alignCenter'),
        alignRight: document.getElementById('alignRight'),
        propWidth: document.getElementById('propWidth'),
        propHeight: document.getElementById('propHeight'),
        deleteElementBtn: document.getElementById('deleteElementBtn'),
        previewCanvas: document.getElementById('previewCanvas'),
        previewModal: document.getElementById('previewModal')
    };

    document.addEventListener('DOMContentLoaded', init);

    function init() {
        hydrateState();
        bindEvents();
        renderAll();
    }

    function hydrateState() {
        const json = document.getElementById('slide-editor-data');
        let parsed = [];

        if (json) {
            try {
                parsed = JSON.parse(json.textContent || '[]');
            } catch (error) {
                parsed = [];
            }
        }

        if (!Array.isArray(parsed) || parsed.length === 0) {
            parsed = [createSlide('Slide 1')];
        }

        state.slides = parsed.map(normalizeSlide);
        state.activeSlideId = state.slides[0].id;
    }

    function bindEvents() {
        els.addTextBtn.addEventListener('click', addTextElement);
        els.addImageBtn.addEventListener('click', handleAddImage);
        els.imageUploadInput.addEventListener('change', onLocalImagePicked);
        els.addSlideBtn.addEventListener('click', addSlide);
        els.addSlideMiniBtn.addEventListener('click', addSlide);
        els.saveDeckBtn.addEventListener('click', fakeSave);
        els.previewBtn.addEventListener('click', openPreview);
        els.deleteElementBtn.addEventListener('click', deleteSelectedElement);

        els.slidesList.addEventListener('click', onSlidesListClick);
        els.layersList.addEventListener('click', onLayersListClick);
        els.canvas.addEventListener('click', onCanvasClick);
        els.canvas.addEventListener('dblclick', onCanvasDoubleClick);
        els.canvas.addEventListener('pointerdown', onCanvasPointerDown);

        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', onPointerUp);
        document.addEventListener('keydown', onKeyDown);

        bindPropertyEvents();
    }

    function bindPropertyEvents() {
        const numberInputs = [els.propX, els.propY, els.propFontSize, els.propWidth, els.propHeight];
        numberInputs.forEach(function(input) {
            input.addEventListener('input', updateFromProperties);
        });

        els.propText.addEventListener('input', updateFromProperties);
        els.propColor.addEventListener('input', updateFromProperties);

        els.propBold.addEventListener('click', function() {
            const element = getSelectedElement();
            if (!element || element.type !== 'text') return;
            const current = Number(element.styles.fontWeight) >= 600;
            element.styles.fontWeight = current ? 400 : 700;
            renderCanvas();
            renderProperties();
        });

        els.alignLeft.addEventListener('click', function() { setTextAlign('left'); });
        els.alignCenter.addEventListener('click', function() { setTextAlign('center'); });
        els.alignRight.addEventListener('click', function() { setTextAlign('right'); });
    }

    function onSlidesListClick(event) {
        const deleteBtn = event.target.closest('.delete-slide-btn');
        if (deleteBtn) {
            event.stopPropagation();
            deleteSlide(deleteBtn.dataset.slideId);
            return;
        }

        const item = event.target.closest('[data-slide-id]');
        if (!item) return;

        state.activeSlideId = item.dataset.slideId;
        state.selectedElementId = null;
        renderAll();
    }

    function onLayersListClick(event) {
        const layer = event.target.closest('[data-element-id]');
        if (!layer) return;

        state.selectedElementId = layer.dataset.elementId;
        renderCanvas();
        renderLayersList();
        renderProperties();
    }

    function onCanvasClick(event) {
        const deleteButton = event.target.closest('.delete-element-btn');
        if (deleteButton) {
            const elementId = deleteButton.dataset.elementId;
            if (elementId) {
                deleteElementById(elementId);
            }
            return;
        }

        const selected = event.target.closest('.slide-element');
        if (selected) {
            state.selectedElementId = selected.dataset.elementId;
        } else {
            state.selectedElementId = null;
        }

        renderCanvas();
        renderLayersList();
        renderProperties();
    }

    function onCanvasDoubleClick(event) {
        const selected = event.target.closest('.slide-element.text-element');
        if (!selected) return;

        selected.contentEditable = 'true';
        selected.focus();

        const update = function() {
            const element = getSelectedElement();
            if (element && element.type === 'text') {
                element.content = selected.innerText;
            }
            selected.contentEditable = 'false';
            selected.removeEventListener('blur', update);
            renderLayersList();
            renderProperties();
        };

        selected.addEventListener('blur', update);
    }

    function onCanvasPointerDown(event) {
        if (event.target.closest('.delete-element-btn')) {
            return;
        }

        const handle = event.target.closest('.resize-handle');
        const elementNode = event.target.closest('.slide-element');
        if (!elementNode) return;

        state.selectedElementId = elementNode.dataset.elementId;
        renderLayersList();
        renderProperties();

        const selected = getSelectedElement();
        if (!selected) return;

        const point = canvasPoint(event);
        state.activePointerId = event.pointerId;

        if (typeof elementNode.setPointerCapture === 'function') {
            try {
                elementNode.setPointerCapture(event.pointerId);
            } catch (error) {
                // Ignore capture errors and continue with document-level listeners.
            }
        }

        if (handle) {
            state.resize = {
                id: selected.id,
                handle: handle.dataset.handle,
                startX: point.x,
                startY: point.y,
                startW: selected.width,
                startH: selected.height,
                startElementX: selected.x,
                startElementY: selected.y
            };
            event.preventDefault();
            return;
        }

        state.drag = {
            id: selected.id,
            offsetX: point.x - selected.x,
            offsetY: point.y - selected.y
        };

        event.preventDefault();
    }

    function onPointerMove(event) {
        if (state.activePointerId !== null && event.pointerId !== state.activePointerId) return;
        if (!state.drag && !state.resize) return;

        const slide = getActiveSlide();
        if (!slide) return;

        if (state.drag) {
            const item = slide.elements.find(function(el) { return el.id === state.drag.id; });
            if (!item) return;

            const point = canvasPoint(event);
            item.x = clamp(Math.round(point.x - state.drag.offsetX), 0, BASE_WIDTH - item.width);
            item.y = clamp(Math.round(point.y - state.drag.offsetY), 0, BASE_HEIGHT - item.height);
            syncElementNode(item);
            renderProperties();
            return;
        }

        if (state.resize) {
            const item = slide.elements.find(function(el) { return el.id === state.resize.id; });
            if (!item) return;

            const minW = item.type === 'text' ? 80 : 60;
            const minH = item.type === 'text' ? 36 : 60;
            const point = canvasPoint(event);
            const dx = Math.round(point.x - state.resize.startX);
            const dy = Math.round(point.y - state.resize.startY);

            let nextX = state.resize.startElementX;
            let nextY = state.resize.startElementY;
            let nextW = state.resize.startW;
            let nextH = state.resize.startH;

            if (state.resize.handle.includes('e')) nextW = state.resize.startW + dx;
            if (state.resize.handle.includes('s')) nextH = state.resize.startH + dy;
            if (state.resize.handle.includes('w')) {
                nextW = state.resize.startW - dx;
                nextX = state.resize.startElementX + dx;
            }
            if (state.resize.handle.includes('n')) {
                nextH = state.resize.startH - dy;
                nextY = state.resize.startElementY + dy;
            }

            nextW = Math.max(minW, nextW);
            nextH = Math.max(minH, nextH);
            nextX = clamp(nextX, 0, BASE_WIDTH - nextW);
            nextY = clamp(nextY, 0, BASE_HEIGHT - nextH);

            item.x = Math.round(nextX);
            item.y = Math.round(nextY);
            item.width = Math.round(nextW);
            item.height = Math.round(nextH);

            syncElementNode(item);
            renderProperties();
        }
    }

    function onPointerUp() {
        state.drag = null;
        state.resize = null;
        state.activePointerId = null;
        // Repaint once at interaction end to keep handles and controls aligned.
        renderCanvas();
    }

    function onKeyDown(event) {
        if (event.key !== 'Delete') return;

        const activeTag = (document.activeElement && document.activeElement.tagName || '').toLowerCase();
        if (activeTag === 'input' || activeTag === 'textarea') return;

        deleteSelectedElement();
    }

    function addTextElement() {
        const slide = getActiveSlide();
        if (!slide) return;

        const item = {
            id: uid('el'),
            type: 'text',
            x: 120,
            y: 100,
            width: 360,
            height: 70,
            content: 'Double-click to edit text',
            styles: {
                fontSize: 34,
                color: '#1c1d1f',
                fontWeight: 600,
                textAlign: 'left'
            }
        };

        slide.elements.push(item);
        state.selectedElementId = item.id;
        renderAll();
    }

    function handleAddImage() {
        const fromUrl = window.prompt('Paste image URL (leave empty to upload from your device):', '');

        if (fromUrl && fromUrl.trim()) {
            addImageElement(fromUrl.trim());
            return;
        }

        els.imageUploadInput.value = '';
        els.imageUploadInput.click();
    }

    function onLocalImagePicked(event) {
        const file = event.target.files && event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(loadEvent) {
            const result = loadEvent.target && loadEvent.target.result;
            if (typeof result === 'string' && result) {
                addImageElement(result);
            }
        };
        reader.readAsDataURL(file);
    }

    function addImageElement(src) {
        const slide = getActiveSlide();
        if (!slide) return;

        const candidateSrc = String(src || '').trim();
        if (!candidateSrc) {
            showToast('Image URL is empty.');
            return;
        }

        const imageProbe = new Image();
        imageProbe.onload = function() {
            console.log('[SlideEditor] Image loaded:', candidateSrc);

            const item = {
                id: uid('el'),
                type: 'image',
                x: 180,
                y: 150,
                width: 360,
                height: 220,
                src: candidateSrc,
                styles: {}
            };

            slide.elements.push(item);
            state.selectedElementId = item.id;
            console.log('[SlideEditor] Elements:', slide.elements);
            renderAll();
        };

        imageProbe.onerror = function() {
            console.error('[SlideEditor] Invalid image URL:', candidateSrc);
            showToast('Unable to load image URL. Check the link and try again.');
        };

        imageProbe.src = candidateSrc;
    }

    function addSlide() {
        const number = state.slides.length + 1;
        const slide = createSlide('Slide ' + number);
        state.slides.push(slide);
        state.activeSlideId = slide.id;
        state.selectedElementId = null;
        renderAll();
    }

    function deleteSelectedElement() {
        const slide = getActiveSlide();
        if (!slide || !state.selectedElementId) return;

        slide.elements = slide.elements.filter(function(el) {
            return el.id !== state.selectedElementId;
        });

        state.selectedElementId = null;
        renderAll();
    }

    function deleteElementById(elementId) {
        const slide = getActiveSlide();
        if (!slide) return;

        slide.elements = slide.elements.filter(function(el) {
            return el.id !== elementId;
        });

        if (state.selectedElementId === elementId) {
            state.selectedElementId = null;
        }

        console.log('[SlideEditor] Elements:', slide.elements);
        renderAll();
    }

    function deleteSlide(slideId) {
        if (!slideId) return;

        if (state.slides.length <= 1) {
            showToast('At least one slide is required.');
            return;
        }

        state.slides = state.slides.filter(function(slide) {
            return slide.id !== slideId;
        });

        if (state.activeSlideId === slideId) {
            state.activeSlideId = state.slides[0].id;
            state.selectedElementId = null;
        }

        renderAll();
    }

    function updateFromProperties() {
        const selected = getSelectedElement();
        if (!selected) return;

        selected.x = clamp(toNumber(els.propX.value, selected.x), 0, BASE_WIDTH - selected.width);
        selected.y = clamp(toNumber(els.propY.value, selected.y), 0, BASE_HEIGHT - selected.height);

        if (selected.type === 'text') {
            selected.content = els.propText.value;
            selected.styles.fontSize = clamp(toNumber(els.propFontSize.value, 28), 10, 120);
            selected.styles.color = els.propColor.value;
        }

        if (selected.type === 'image') {
            selected.width = clamp(toNumber(els.propWidth.value, selected.width), 40, BASE_WIDTH);
            selected.height = clamp(toNumber(els.propHeight.value, selected.height), 40, BASE_HEIGHT);
            selected.x = clamp(selected.x, 0, BASE_WIDTH - selected.width);
            selected.y = clamp(selected.y, 0, BASE_HEIGHT - selected.height);
        }

        renderCanvas();
        renderLayersList();
    }

    function setTextAlign(align) {
        const selected = getSelectedElement();
        if (!selected || selected.type !== 'text') return;
        selected.styles.textAlign = align;
        renderCanvas();
        renderProperties();
    }

    function fakeSave() {
        const payload = {
            title: document.getElementById('slideDeckTitle').value,
            slides: state.slides
        };

        console.log('[SlideEditor] Save payload', payload);
        showToast('Deck is ready. Backend save is intentionally skipped.');
    }

    function openPreview() {
        const slide = getActiveSlide();
        if (!slide) return;

        els.previewCanvas.innerHTML = '';

        slide.elements.forEach(function(element) {
            const node = document.createElement('div');
            node.style.position = 'absolute';
            node.style.left = element.x + 'px';
            node.style.top = element.y + 'px';
            node.style.width = element.width + 'px';
            node.style.height = element.height + 'px';
            node.style.overflow = 'hidden';

            if (element.type === 'text') {
                node.style.fontSize = (element.styles.fontSize || 28) + 'px';
                node.style.color = element.styles.color || '#1c1d1f';
                node.style.fontWeight = String(element.styles.fontWeight || 400);
                node.style.textAlign = element.styles.textAlign || 'left';
                node.style.whiteSpace = 'pre-wrap';
                node.style.lineHeight = '1.25';
                node.textContent = element.content || '';
            } else {
                const image = document.createElement('img');
                image.src = element.src || '';
                image.alt = '';
                image.style.width = '100%';
                image.style.height = '100%';
                image.style.objectFit = 'cover';
                node.appendChild(image);
            }

            els.previewCanvas.appendChild(node);
        });

        const modal = bootstrap.Modal.getOrCreateInstance(els.previewModal);
        modal.show();
    }

    function renderAll() {
        renderSlidesList();
        renderLayersList();
        renderCanvas();
        renderProperties();
    }

    function renderSlidesList() {
        const activeId = state.activeSlideId;

        els.slidesList.innerHTML = state.slides.map(function(slide, index) {
            const isActive = slide.id === activeId ? 'active' : '';
            return '' +
                '<li class="se-list-item ' + isActive + '" data-slide-id="' + slide.id + '">' +
                    '<div>' +
                        '<strong>' + escapeHtml(slide.title || ('Slide ' + (index + 1))) + '</strong>' +
                        '<div class="se-list-item-meta">' + slide.elements.length + ' elements</div>' +
                    '</div>' +
                    '<div class="se-list-actions">' +
                        '<span class="badge text-bg-light border">' + (index + 1) + '</span>' +
                        '<button class="delete-slide-btn" data-slide-id="' + slide.id + '" type="button" aria-label="Delete slide">' +
                            '<i class="fa-regular fa-trash-can"></i>' +
                        '</button>' +
                    '</div>' +
                '</li>';
        }).join('');
    }

    function renderLayersList() {
        const slide = getActiveSlide();
        if (!slide) {
            els.layersList.innerHTML = '';
            return;
        }

        const ordered = slide.elements.slice().reverse();

        els.layersList.innerHTML = ordered.map(function(el, index) {
            const active = el.id === state.selectedElementId ? 'active' : '';
            const icon = el.type === 'text' ? 'fa-font' : 'fa-image';
            const label = el.type === 'text' ? (el.content || 'Text') : 'Image';
            return '' +
                '<li class="se-list-item ' + active + '" data-element-id="' + el.id + '">' +
                    '<span><i class="fa-solid ' + icon + ' me-2"></i>' + escapeHtml(label).slice(0, 32) + '</span>' +
                    '<span class="se-list-item-meta">L' + (index + 1) + '</span>' +
                '</li>';
        }).join('');
    }

    function renderCanvas() {
        const slide = getActiveSlide();
        if (!slide) {
            els.canvas.innerHTML = '';
            return;
        }

        els.canvas.innerHTML = '';
        slide.elements.forEach(function(item) {
            const node = document.createElement('div');
            node.className = 'slide-element ' + (item.type === 'text' ? 'text-element' : 'image-element') + (item.id === state.selectedElementId ? ' selected' : '');
            node.dataset.elementId = item.id;
            node.dataset.type = item.type;

            syncElementNode(item, node);

            if (item.type === 'text') {
                node.style.fontSize = (item.styles.fontSize || 28) + 'px';
                node.style.color = item.styles.color || '#1c1d1f';
                node.style.fontWeight = String(item.styles.fontWeight || 400);
                node.style.textAlign = item.styles.textAlign || 'left';
                node.textContent = item.content || 'Text';
            } else {
                const image = document.createElement('img');
                image.src = item.src || '';
                image.alt = 'Slide image';
                image.loading = 'lazy';
                image.addEventListener('error', function() {
                    console.error('[SlideEditor] Invalid image URL:', item.src || '');
                }, { once: true });
                node.appendChild(image);
            }

            node.insertAdjacentHTML('beforeend', resizeHandles());

            const deleteButton = document.createElement('button');
            deleteButton.className = 'delete-element-btn';
            deleteButton.type = 'button';
            deleteButton.dataset.elementId = item.id;
            deleteButton.setAttribute('aria-label', 'Delete element');
            deleteButton.innerHTML = '<i class="fa-regular fa-trash-can"></i>';
            node.appendChild(deleteButton);

            els.canvas.appendChild(node);
        });
    }

    function renderProperties() {
        const selected = getSelectedElement();
        if (!selected) {
            els.emptyProperties.classList.remove('d-none');
            els.propertiesPanel.classList.add('d-none');
            return;
        }

        els.emptyProperties.classList.add('d-none');
        els.propertiesPanel.classList.remove('d-none');
        els.textProps.classList.toggle('d-none', selected.type !== 'text');
        els.imageProps.classList.toggle('d-none', selected.type !== 'image');

        els.propX.value = selected.x;
        els.propY.value = selected.y;

        if (selected.type === 'text') {
            els.propText.value = selected.content || '';
            els.propFontSize.value = selected.styles.fontSize || 28;
            els.propColor.value = selected.styles.color || '#1c1d1f';

            const isBold = Number(selected.styles.fontWeight) >= 600;
            els.propBold.classList.toggle('btn-dark', isBold);
            els.propBold.classList.toggle('btn-outline-dark', !isBold);

            toggleAlignButton(els.alignLeft, selected.styles.textAlign === 'left');
            toggleAlignButton(els.alignCenter, selected.styles.textAlign === 'center');
            toggleAlignButton(els.alignRight, selected.styles.textAlign === 'right');
        }

        if (selected.type === 'image') {
            els.propWidth.value = selected.width;
            els.propHeight.value = selected.height;
        }
    }

    function resizeHandles() {
        return '' +
            '<span class="resize-handle nw" data-handle="nw"></span>' +
            '<span class="resize-handle ne" data-handle="ne"></span>' +
            '<span class="resize-handle sw" data-handle="sw"></span>' +
            '<span class="resize-handle se" data-handle="se"></span>';
    }

    function toggleAlignButton(button, active) {
        button.classList.toggle('btn-secondary', active);
        button.classList.toggle('btn-outline-secondary', !active);
    }

    function createSlide(title) {
        return {
            id: uid('slide'),
            title: title,
            elements: []
        };
    }

    function normalizeSlide(slide, index) {
        const safeSlide = {
            id: slide.id || uid('slide'),
            title: slide.title || ('Slide ' + (index + 1)),
            elements: Array.isArray(slide.elements) ? slide.elements : []
        };

        safeSlide.elements = safeSlide.elements.map(function(item) {
            return {
                id: item.id || uid('el'),
                type: item.type === 'image' ? 'image' : 'text',
                x: clamp(toNumber(item.x, 40), 0, BASE_WIDTH),
                y: clamp(toNumber(item.y, 40), 0, BASE_HEIGHT),
                width: clamp(toNumber(item.width, item.type === 'image' ? 320 : 280), 40, BASE_WIDTH),
                height: clamp(toNumber(item.height, item.type === 'image' ? 220 : 80), 30, BASE_HEIGHT),
                content: item.content || 'Text',
                src: item.src || '',
                styles: {
                    fontSize: clamp(toNumber(item.styles && item.styles.fontSize, 28), 10, 120),
                    color: (item.styles && item.styles.color) || '#1c1d1f',
                    fontWeight: toNumber(item.styles && item.styles.fontWeight, 400),
                    textAlign: (item.styles && item.styles.textAlign) || 'left'
                }
            };
        });

        return safeSlide;
    }

    function getActiveSlide() {
        return state.slides.find(function(slide) { return slide.id === state.activeSlideId; }) || null;
    }

    function getSelectedElement() {
        const slide = getActiveSlide();
        if (!slide) return null;
        return slide.elements.find(function(el) { return el.id === state.selectedElementId; }) || null;
    }

    function canvasPoint(event) {
        const rect = els.canvas.getBoundingClientRect();
        const scaleX = BASE_WIDTH / rect.width;
        const scaleY = BASE_HEIGHT / rect.height;

        return {
            x: (event.clientX - rect.left) * scaleX,
            y: (event.clientY - rect.top) * scaleY
        };
    }

    function syncElementNode(item, providedNode) {
        const node = providedNode || els.canvas.querySelector('[data-element-id="' + item.id + '"]');
        if (!node) return;

        node.style.left = item.x + 'px';
        node.style.top = item.y + 'px';
        node.style.width = item.width + 'px';
        node.style.height = item.height + 'px';
    }

    function uid(prefix) {
        return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    }

    function toNumber(value, fallback) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/\n/g, '<br>');
    }

    function escapeAttribute(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function showToast(message) {
        let toast = document.querySelector('.se-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'se-toast';
            document.body.appendChild(toast);
        }

        toast.textContent = message;
        toast.classList.add('show');

        if (state.toastTimer) {
            window.clearTimeout(state.toastTimer);
        }

        state.toastTimer = window.setTimeout(function() {
            toast.classList.remove('show');
        }, 1800);
    }
})();
