(function() {
    'use strict';

    const BASE_WIDTH = 1280;
    const BASE_HEIGHT = 720;
    const MAX_TEXT_FONT_SIZE = 40;
    const MIN_TEXT_FONT_SIZE = 10;
    const IMAGE_MAX_WIDTH = Math.round(BASE_WIDTH * 0.7);
    const IMAGE_MAX_HEIGHT = Math.round(BASE_HEIGHT * 0.65);
    const pageMeta = document.body && document.body.dataset ? document.body.dataset : {};
    const courseId = pageMeta.courseId || '';
    const sectionIndex = pageMeta.sectionIndex || '';
    const lessonIndex = pageMeta.lessonIndex || '';

    const state = {
        slides: [],
        activeSlideId: null,
        selectedElementId: null,
        drag: null,
        resize: null,
        activePointerId: null,
        toastTimer: null,
        dragSlideId: null
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
        saveToLibraryBtn: document.getElementById('saveToLibraryBtn'),
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
        propImageSrc: document.getElementById('propImageSrc'),
        propImageUploadBtn: document.getElementById('propImageUploadBtn'),
        propImageUploadInput: document.getElementById('propImageUploadInput'),
        propImagePreview: document.getElementById('propImagePreview'),
        propImagePreviewEmpty: document.getElementById('propImagePreviewEmpty'),
        deleteElementBtn: document.getElementById('deleteElementBtn'),
        slideThemeSelect: document.getElementById('slideThemeSelect'),
        previewCanvas: document.getElementById('previewCanvas'),
        previewModal: document.getElementById('previewModal'),
        guideX: null,
        guideY: null,
        textMeasure: null
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
            } catch {
                parsed = [];
            }
        }

        if (!Array.isArray(parsed) || parsed.length === 0) {
            parsed = [createSlide('Slide 1')];
        }

        state.slides = parsed.map(normalizeSlide);
        state.activeSlideId = state.slides[0].id;
        applyAiSlidesFromStorage();
    }

    function bindEvents() {
        els.addTextBtn.addEventListener('click', addTextElement);
        els.addImageBtn.addEventListener('click', handleAddImage);
        els.imageUploadInput.addEventListener('change', onLocalImagePicked);
        els.addSlideBtn.addEventListener('click', addSlide);
        els.addSlideMiniBtn.addEventListener('click', addSlide);
        els.saveDeckBtn.addEventListener('click', saveDeck);
        if (els.saveToLibraryBtn) {
            els.saveToLibraryBtn.addEventListener('click', saveToLibrary);
        }
        els.previewBtn.addEventListener('click', openPreview);
        els.deleteElementBtn.addEventListener('click', deleteSelectedElement);
        if (els.slideThemeSelect) {
            els.slideThemeSelect.addEventListener('change', function() {
                const slide = getActiveSlide();
                if (!slide) return;
                slide.theme = String(els.slideThemeSelect.value || 'light');
                renderCanvas();
                renderSlidesList();
            });
        }

        els.slidesList.addEventListener('click', onSlidesListClick);
        els.slidesList.addEventListener('dragstart', onSlidesDragStart);
        els.slidesList.addEventListener('dragover', onSlidesDragOver);
        els.slidesList.addEventListener('drop', onSlidesDrop);
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
        if (els.propImageSrc) {
            els.propImageSrc.addEventListener('change', onImageSourceChanged);
        }
        if (els.propImageUploadBtn && els.propImageUploadInput) {
            els.propImageUploadBtn.addEventListener('click', function() {
                els.propImageUploadInput.value = '';
                els.propImageUploadInput.click();
            });
            els.propImageUploadInput.addEventListener('change', onImageReplacementPicked);
        }

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

        const duplicateBtn = event.target.closest('.duplicate-slide-btn');
        if (duplicateBtn) {
            event.stopPropagation();
            duplicateSlide(duplicateBtn.dataset.slideId);
            return;
        }

        const item = event.target.closest('[data-slide-id]');
        if (!item) return;

        state.activeSlideId = item.dataset.slideId;
        state.selectedElementId = null;
        renderAll();
    }

    function onSlidesDragStart(event) {
        if (event.target.closest('button')) return;
        const item = event.target.closest('[data-slide-id]');
        if (!item) return;
        state.dragSlideId = item.dataset.slideId;
        event.dataTransfer.effectAllowed = 'move';
    }

    function onSlidesDragOver(event) {
        const item = event.target.closest('[data-slide-id]');
        if (!item || !state.dragSlideId) return;
        event.preventDefault();
        document.querySelectorAll('.se-list-item').forEach((node) => node.classList.remove('drag-over'));
        item.classList.add('drag-over');
    }

    function onSlidesDrop(event) {
        const item = event.target.closest('[data-slide-id]');
        if (!item || !state.dragSlideId) return;
        event.preventDefault();

        const fromIndex = state.slides.findIndex((slide) => slide.id === state.dragSlideId);
        const toIndex = state.slides.findIndex((slide) => slide.id === item.dataset.slideId);
        state.dragSlideId = null;
        document.querySelectorAll('.se-list-item').forEach((node) => node.classList.remove('drag-over'));

        if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
        const moved = state.slides.splice(fromIndex, 1)[0];
        state.slides.splice(toIndex, 0, moved);
        state.activeSlideId = moved.id;
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
            } catch {
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
            const proposedX = clamp(Math.round(point.x - state.drag.offsetX), 0, BASE_WIDTH - item.width);
            const proposedY = clamp(Math.round(point.y - state.drag.offsetY), 0, BASE_HEIGHT - item.height);
            const snapped = applySnap(item, slide, proposedX, proposedY);

            item.x = snapped.x;
            item.y = snapped.y;
            updateGuides(snapped.guides);
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
            if (item.type === 'text') {
                fitTextElementToBounds(item);
            }

            syncElementNode(item);
            renderProperties();
        }
    }

    function onPointerUp() {
        state.drag = null;
        state.resize = null;
        state.activePointerId = null;
        updateGuides(null);
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
        const fromUrl = window.prompt('Enter image URL:', '');

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
            const fitted = fitImageSizeToCanvas(imageProbe.naturalWidth, imageProbe.naturalHeight);

            const item = {
                id: uid('el'),
                type: 'image',
                x: Math.round((BASE_WIDTH - fitted.width) / 2),
                y: Math.round((BASE_HEIGHT - fitted.height) / 2),
                width: fitted.width,
                height: fitted.height,
                src: candidateSrc,
                styles: {}
            };

            slide.elements.push(item);
            state.selectedElementId = item.id;
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

    function duplicateSlide(slideId) {
        const index = state.slides.findIndex((slide) => slide.id === slideId);
        if (index < 0) return;
        const base = state.slides[index];
        const cloned = JSON.parse(JSON.stringify(base));
        cloned.id = uid('slide');
        cloned.title = (base.title || 'Slide') + ' (Copy)';
        cloned.elements = (cloned.elements || []).map((el) => ({
            ...el,
            id: uid('el')
        }));
        state.slides.splice(index + 1, 0, cloned);
        state.activeSlideId = cloned.id;
        state.selectedElementId = null;
        renderAll();
    }

    function updateFromProperties() {
        const selected = getSelectedElement();
        if (!selected) return;

        selected.x = clamp(toNumber(els.propX.value, selected.x), 0, BASE_WIDTH - selected.width);
        selected.y = clamp(toNumber(els.propY.value, selected.y), 0, BASE_HEIGHT - selected.height);

        if (selected.type === 'text') {
            selected.content = els.propText.value;
            selected.styles.fontSize = clamp(toNumber(els.propFontSize.value, 28), MIN_TEXT_FONT_SIZE, MAX_TEXT_FONT_SIZE);
            selected.styles.color = els.propColor.value;
            fitTextElementToBounds(selected);
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

    function onImageSourceChanged() {
        const selected = getSelectedElement();
        if (!selected || selected.type !== 'image' || !els.propImageSrc) return;

        const nextSrc = String(els.propImageSrc.value || '').trim();
        if (!nextSrc) {
            showToast('Image URL is empty.');
            els.propImageSrc.value = selected.src || '';
            return;
        }

        setSelectedImageSource(nextSrc);
    }

    function onImageReplacementPicked(event) {
        const selected = getSelectedElement();
        if (!selected || selected.type !== 'image') return;

        const file = event.target.files && event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(loadEvent) {
            const result = loadEvent.target && loadEvent.target.result;
            if (typeof result !== 'string' || !result) return;
            setSelectedImageSource(result);
        };
        reader.readAsDataURL(file);
    }

    function setSelectedImageSource(src) {
        const selected = getSelectedElement();
        if (!selected || selected.type !== 'image') return;

        const nextSrc = String(src || '').trim();
        if (!nextSrc) return;

        const previousSrc = selected.src || '';
        const probe = new Image();

        probe.onload = function() {
            selected.src = nextSrc;
            applyImageNaturalSize(selected, probe);
            renderCanvas();
            renderLayersList();
            renderProperties();
        };

        probe.onerror = function() {
            showToast('Unable to load image. Check the URL or choose another file.');
            if (els.propImageSrc) {
                els.propImageSrc.value = previousSrc;
            }
            renderProperties();
        };

        probe.src = nextSrc;
    }

    function setTextAlign(align) {
        const selected = getSelectedElement();
        if (!selected || selected.type !== 'text') return;
        selected.styles.textAlign = align;
        renderCanvas();
        renderProperties();
    }

    async function saveDeck() {
        if (!courseId || sectionIndex === '' || lessonIndex === '') {
            showToast('Missing lesson location. Open editor from a lesson first.');
            return;
        }

        const payload = {
            title: document.getElementById('slideDeckTitle').value,
            sectionIndex: Number(sectionIndex),
            lessonIndex: Number(lessonIndex),
            content: {
                slides: serializeSlides(state.slides)
            }
        };
        console.log('[SlideEditor] save payload:', {
            sectionIndex: payload.sectionIndex,
            lessonIndex: payload.lessonIndex,
            title: payload.title,
            slideCount: payload.content.slides.length
        });

        try {
            const response = await fetch('/admin/course/' + encodeURIComponent(courseId) + '/slide-editor/save', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Save failed');
            }

            showToast('Slides saved successfully.');
        } catch (error) {
            console.error('[SlideEditor] Save failed:', error);
            showToast('Save failed. Please try again.');
        }
    }

    async function saveToLibrary() {
        if (!state.slides.length) {
            showToast('Add at least one slide before saving.');
            return;
        }

        const titleInput = document.getElementById('slideDeckTitle');
        const title = String(titleInput && titleInput.value || '').trim() || 'AI Generated Slide';
        const payload = {
            type: 'slide',
            name: title,
            content: {
                slides: serializeSlides(state.slides)
            }
        };

        try {
            const response = await fetch('/library/save-slide', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data && data.error ? data.error : 'Save failed');
            }

            showToast('Saved to Content Library!');
        } catch (error) {
            console.error('[SlideEditor] Save to library failed:', error);
            showToast('Save to library failed. Please try again.');
        }
    }

    function openPreview() {
        const slide = getActiveSlide();
        if (!slide) return;

        els.previewCanvas.innerHTML = '';
        applySlideTheme(slide, els.previewCanvas);
        applySlideTheme(slide, els.previewCanvas);

        slide.elements.forEach(function(element) {
            const node = document.createElement('div');
            node.style.position = 'absolute';
            node.style.left = element.x + 'px';
            node.style.top = element.y + 'px';
            node.style.width = element.width + 'px';
            node.style.height = element.height + 'px';
            node.style.overflow = 'hidden';

            if (element.type === 'image') {
                const image = document.createElement('img');
                image.src = element.src || '';
                image.alt = 'Slide image';
                image.style.width = '100%';
                image.style.height = '100%';
                image.style.objectFit = 'contain';
                node.appendChild(image);
                els.previewCanvas.appendChild(node);
                return;
            }

            fitTextElementToBounds(element);
            node.style.fontSize = (element.styles.fontSize || 28) + 'px';
            node.style.color = element.styles.color || '#1c1d1f';
            node.style.fontWeight = String(element.styles.fontWeight || 400);
            node.style.textAlign = element.styles.textAlign || 'left';
            node.style.whiteSpace = 'pre-wrap';
            node.style.overflowWrap = 'anywhere';
            node.style.lineHeight = '1.25';
            node.textContent = element.content || '';

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
                '<li class="se-list-item ' + isActive + '" data-slide-id="' + slide.id + '" draggable="true">' +
                    '<div>' +
                        '<strong>' + escapeHtml(slide.title || ('Slide ' + (index + 1))) + '</strong>' +
                        '<div class="se-list-item-meta">' + slide.elements.length + ' elements</div>' +
                        renderSlideThumbnail(slide) +
                    '</div>' +
                    '<div class="se-list-actions">' +
                        '<button class="duplicate-slide-btn" data-slide-id="' + slide.id + '" type="button" aria-label="Duplicate slide">' +
                            '<i class="fa-regular fa-copy"></i>' +
                        '</button>' +
                        '<button class="delete-slide-btn" data-slide-id="' + slide.id + '" type="button" aria-label="Delete slide">' +
                            '<i class="fa-regular fa-trash-can"></i>' +
                        '</button>' +
                    '</div>' +
                '</li>';
        }).join('');
    }

    function renderSlideThumbnail(slide) {
        const thumbWidth = 160;
        const thumbHeight = 90;
        const scaleX = thumbWidth / BASE_WIDTH;
        const scaleY = thumbHeight / BASE_HEIGHT;

        const elementsHtml = (slide.elements || []).map(function(el) {
            const left = Math.round((el.x || 0) * scaleX);
            const top = Math.round((el.y || 0) * scaleY);
            const fontSize = Math.max(8, Math.round((el.styles && el.styles.fontSize ? el.styles.fontSize : el.fontSize || 18) * scaleX));

            if (el.type === 'image') {
                const width = Math.max(12, Math.round((el.width || 120) * scaleX));
                const height = Math.max(10, Math.round((el.height || 80) * scaleY));
                return '<div class="se-thumb-element se-thumb-image" style="left:' + left + 'px;top:' + top + 'px;width:' + width + 'px;height:' + height + 'px;"></div>';
            }

            return '<div class="se-thumb-element se-thumb-text" style="left:' + left + 'px;top:' + top + 'px;font-size:' + fontSize + 'px;">' + escapeHtml(el.content || el.text || '') + '</div>';
        }).join('');

        const palette = getThemePalette(slide && slide.theme);
        return '<div class="se-thumb-canvas" style="background:' + palette.bg + ';color:' + palette.text + ';" aria-hidden="true">' + elementsHtml + '</div>';
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

        applySlideTheme(slide, els.canvas);

        els.canvas.innerHTML = '';
        ensureGuides();
        slide.elements.forEach(function(item) {
            const node = document.createElement('div');
            node.className = 'slide-element ' + (item.type === 'image' ? 'image-element' : 'text-element') + (item.id === state.selectedElementId ? ' selected' : '');
            node.dataset.elementId = item.id;
            node.dataset.type = item.type;

            syncElementNode(item, node);

            if (item.type === 'image') {
                const image = document.createElement('img');
                image.src = item.src || '';
                image.alt = 'Slide image';
                image.loading = 'lazy';
                image.style.width = '100%';
                image.style.height = '100%';
                image.style.objectFit = 'contain';
                image.addEventListener('error', function() {
                    console.error('[SlideEditor] Invalid image URL:', item.src || '');
                }, { once: true });
                node.appendChild(image);
            } else {
                fitTextElementToBounds(item);
                node.style.fontSize = (item.styles.fontSize || 28) + 'px';
                node.style.color = item.styles.color || '#1c1d1f';
                node.style.fontWeight = String(item.styles.fontWeight || 400);
                node.style.textAlign = item.styles.textAlign || 'left';
                node.style.overflowWrap = 'anywhere';
                node.textContent = item.content || 'Text';
            }

            node.insertAdjacentHTML('beforeend', resizeHandles());

            els.canvas.appendChild(node);
        });
    }

    function renderProperties() {
        const selected = getSelectedElement();
        const activeSlide = getActiveSlide();
        if (els.slideThemeSelect && activeSlide) {
            els.slideThemeSelect.value = String(activeSlide.theme || 'light');
        }
        if (!selected) {
            els.emptyProperties.classList.remove('d-none');
            els.propertiesPanel.classList.add('d-none');
            updateImagePreview('');
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
            updateImagePreview('');
        }

        if (selected.type === 'image') {
            if (els.propImageSrc) {
                els.propImageSrc.value = selected.src || '';
            }
            els.propWidth.value = selected.width;
            els.propHeight.value = selected.height;
            updateImagePreview(selected.src || '');
        }
    }

    function updateImagePreview(src) {
        if (!els.propImagePreview || !els.propImagePreviewEmpty) return;

        const value = String(src || '').trim();
        if (!value) {
            els.propImagePreview.removeAttribute('src');
            els.propImagePreview.classList.remove('is-visible');
            els.propImagePreviewEmpty.classList.add('is-visible');
            return;
        }

        els.propImagePreview.src = value;
        els.propImagePreview.onerror = function() {
            els.propImagePreview.classList.remove('is-visible');
            els.propImagePreviewEmpty.classList.add('is-visible');
        };
        els.propImagePreview.onload = function() {
            els.propImagePreview.classList.add('is-visible');
            els.propImagePreviewEmpty.classList.remove('is-visible');
        };
        els.propImagePreview.classList.add('is-visible');
        els.propImagePreviewEmpty.classList.remove('is-visible');
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
            layout: slide.layout || 'left-text',
            theme: slide.theme || 'light',
            template: slide.template || '',
            semantic: slide.semantic && typeof slide.semantic === 'object' ? slide.semantic : null,
            validation: slide.validation && typeof slide.validation === 'object' ? slide.validation : null,
            elements: Array.isArray(slide.elements) ? slide.elements : []
        };

        safeSlide.elements = safeSlide.elements.map(function(item) {
            const normalized = {
                id: item.id || uid('el'),
                type: item.type === 'image' ? 'image' : 'text',
                x: clamp(toNumber(item.x, 40), 0, BASE_WIDTH),
                y: clamp(toNumber(item.y, 40), 0, BASE_HEIGHT),
                width: clamp(toNumber(item.width, item.type === 'image' ? 320 : 280), 40, BASE_WIDTH),
                height: clamp(toNumber(item.height, item.type === 'image' ? 220 : 80), 30, BASE_HEIGHT),
                content: item.content || item.text || 'Text',
                src: item.src || '',
                styles: {
                    fontSize: clamp(toNumber(item.styles && item.styles.fontSize, toNumber(item.fontSize, 28)), MIN_TEXT_FONT_SIZE, MAX_TEXT_FONT_SIZE),
                    color: (item.styles && item.styles.color) || item.color || '#1c1d1f',
                    fontWeight: toNumber(item.styles && item.styles.fontWeight, item.bold ? 700 : 400),
                    textAlign: (item.styles && item.styles.textAlign) || item.align || 'left'
                }
            };
            if (normalized.type === 'text') {
                fitTextElementToBounds(normalized);
            } else if (normalized.width > IMAGE_MAX_WIDTH || normalized.height > IMAGE_MAX_HEIGHT) {
                const fitted = fitImageSizeToCanvas(normalized.width, normalized.height);
                normalized.width = fitted.width;
                normalized.height = fitted.height;
                normalized.x = clamp(normalized.x, 0, BASE_WIDTH - normalized.width);
                normalized.y = clamp(normalized.y, 0, BASE_HEIGHT - normalized.height);
            }
            return normalized;
        });

        return safeSlide;
    }

    function applyAiSlidesFromStorage() {
        const stored = localStorage.getItem('AI_SLIDE_DATA');
        if (!stored) return;

        try {
            const parsed = JSON.parse(stored);
            const slides = Array.isArray(parsed && parsed.slides) ? parsed.slides : [];
            if (!slides.length) return;

            state.slides = slides.map(normalizeSlide);
            state.activeSlideId = state.slides[0].id;
            state.selectedElementId = null;

            const title = localStorage.getItem('AI_SLIDE_TITLE');
            const titleInput = document.getElementById('slideDeckTitle');
            if (titleInput && title) {
                titleInput.value = title;
            }
        } catch (error) {
            console.warn('[SlideEditor] Failed to parse AI slide data', error);
        } finally {
            localStorage.removeItem('AI_SLIDE_DATA');
            localStorage.removeItem('AI_SLIDE_TITLE');
        }
    }

    function serializeSlides(slides) {
        return (Array.isArray(slides) ? slides : []).map(function(slide, slideIndex) {
            return {
                id: slide.id || ('slide-' + (slideIndex + 1)),
                title: slide.title || ('Slide ' + (slideIndex + 1)),
                layout: slide.layout || 'left-text',
                theme: slide.theme || 'light',
                template: slide.template || undefined,
                semantic: slide.semantic || undefined,
                validation: slide.validation || undefined,
                elements: (Array.isArray(slide.elements) ? slide.elements : []).map(function(element, elementIndex) {
                    const isImage = element.type === 'image';
                    const textAlign = element.styles && element.styles.textAlign;
                    const normalizedAlign = ['left', 'center', 'right'].includes(textAlign) ? textAlign : 'left';

                    return {
                        id: element.id || ('el-' + (slideIndex + 1) + '-' + (elementIndex + 1)),
                        type: isImage ? 'image' : 'text',
                        x: toNumber(element.x, 0),
                        y: toNumber(element.y, 0),
                        width: clamp(toNumber(element.width, isImage ? 320 : 280), 40, BASE_WIDTH),
                        height: clamp(toNumber(element.height, isImage ? 220 : 80), 30, BASE_HEIGHT),
                        text: isImage ? undefined : String(element.content || ''),
                        src: isImage ? String(element.src || '') : undefined,
                        fontSize: isImage ? undefined : clamp(toNumber(element.styles && element.styles.fontSize, 28), MIN_TEXT_FONT_SIZE, MAX_TEXT_FONT_SIZE),
                        color: isImage ? undefined : String((element.styles && element.styles.color) || '#1c1d1f'),
                        align: isImage ? undefined : normalizedAlign,
                        bold: isImage ? undefined : toNumber(element.styles && element.styles.fontWeight, 400) >= 600
                    };
                })
            };
        });
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

    function fitImageSizeToCanvas(rawWidth, rawHeight) {
        const width = Math.max(1, Math.round(Number(rawWidth) || 1));
        const height = Math.max(1, Math.round(Number(rawHeight) || 1));
        const ratio = Math.min(
            1,
            IMAGE_MAX_WIDTH / width,
            IMAGE_MAX_HEIGHT / height,
            BASE_WIDTH / width,
            BASE_HEIGHT / height
        );

        return {
            width: Math.max(40, Math.round(width * ratio)),
            height: Math.max(40, Math.round(height * ratio))
        };
    }

    function applyImageNaturalSize(element, image) {
        if (!element || element.type !== 'image' || !image) return;

        const fitted = fitImageSizeToCanvas(image.naturalWidth, image.naturalHeight);
        element.width = fitted.width;
        element.height = fitted.height;
        element.x = clamp(element.x, 0, BASE_WIDTH - element.width);
        element.y = clamp(element.y, 0, BASE_HEIGHT - element.height);
    }

    function ensureTextMeasureNode() {
        if (els.textMeasure && document.body.contains(els.textMeasure)) {
            return els.textMeasure;
        }

        const node = document.createElement('div');
        node.style.position = 'absolute';
        node.style.visibility = 'hidden';
        node.style.pointerEvents = 'none';
        node.style.left = '-99999px';
        node.style.top = '-99999px';
        node.style.whiteSpace = 'pre-wrap';
        node.style.overflowWrap = 'anywhere';
        node.style.wordBreak = 'break-word';
        node.style.lineHeight = '1.25';
        document.body.appendChild(node);
        els.textMeasure = node;
        return node;
    }

    function fitTextElementToBounds(element) {
        if (!element || element.type !== 'text') return;

        const measure = ensureTextMeasureNode();
        const width = Math.max(24, Number(element.width || 0) - 16);
        const height = Math.max(24, Number(element.height || 0) - 12);
        const content = String(element.content || '').trim() || 'Text';
        let fontSize = clamp(toNumber(element.styles && element.styles.fontSize, 28), MIN_TEXT_FONT_SIZE, MAX_TEXT_FONT_SIZE);

        measure.style.width = width + 'px';
        measure.style.fontWeight = String(element.styles && element.styles.fontWeight || 400);
        measure.style.textAlign = element.styles && element.styles.textAlign || 'left';
        measure.textContent = content;

        while (fontSize > MIN_TEXT_FONT_SIZE) {
            measure.style.fontSize = fontSize + 'px';
            if (measure.scrollWidth <= width + 1 && measure.scrollHeight <= height + 1) {
                break;
            }
            fontSize -= 1;
        }

        element.styles.fontSize = clamp(fontSize, MIN_TEXT_FONT_SIZE, MAX_TEXT_FONT_SIZE);
    }

    function ensureGuides() {
        if (!els.canvas) return;
        if (!els.guideX) {
            els.guideX = document.createElement('div');
            els.guideX.className = 'se-guide-line se-guide-line--v';
        }
        if (!els.guideY) {
            els.guideY = document.createElement('div');
            els.guideY.className = 'se-guide-line se-guide-line--h';
        }
        els.guideX.style.display = 'none';
        els.guideY.style.display = 'none';
        els.canvas.appendChild(els.guideX);
        els.canvas.appendChild(els.guideY);
    }

    function updateGuides(guides) {
        if (!els.guideX || !els.guideY) return;
        if (!guides) {
            els.guideX.style.display = 'none';
            els.guideY.style.display = 'none';
            return;
        }

        if (typeof guides.x === 'number') {
            els.guideX.style.display = 'block';
            els.guideX.style.left = guides.x + 'px';
        } else {
            els.guideX.style.display = 'none';
        }

        if (typeof guides.y === 'number') {
            els.guideY.style.display = 'block';
            els.guideY.style.top = guides.y + 'px';
        } else {
            els.guideY.style.display = 'none';
        }
    }

    function applySnap(item, slide, proposedX, proposedY) {
        const threshold = 8;
        const guides = { x: null, y: null };
        let snapX = proposedX;
        let snapY = proposedY;

        const centerX = BASE_WIDTH / 2;
        const centerY = BASE_HEIGHT / 2;
        const itemCenterX = proposedX + item.width / 2;
        const itemCenterY = proposedY + item.height / 2;

        if (Math.abs(itemCenterX - centerX) < threshold) {
            snapX = Math.round(centerX - item.width / 2);
            guides.x = Math.round(centerX);
        }
        if (Math.abs(itemCenterY - centerY) < threshold) {
            snapY = Math.round(centerY - item.height / 2);
            guides.y = Math.round(centerY);
        }

        (slide.elements || []).forEach((other) => {
            if (other.id === item.id) return;
            const otherLeft = other.x;
            const otherRight = other.x + other.width;
            const otherCenter = other.x + other.width / 2;
            const otherTop = other.y;
            const otherBottom = other.y + other.height;
            const otherMiddle = other.y + other.height / 2;

            if (Math.abs(proposedX - otherLeft) < threshold) {
                snapX = Math.round(otherLeft);
                guides.x = Math.round(otherLeft);
            } else if (Math.abs(proposedX + item.width - otherRight) < threshold) {
                snapX = Math.round(otherRight - item.width);
                guides.x = Math.round(otherRight);
            } else if (Math.abs(itemCenterX - otherCenter) < threshold) {
                snapX = Math.round(otherCenter - item.width / 2);
                guides.x = Math.round(otherCenter);
            }

            if (Math.abs(proposedY - otherTop) < threshold) {
                snapY = Math.round(otherTop);
                guides.y = Math.round(otherTop);
            } else if (Math.abs(proposedY + item.height - otherBottom) < threshold) {
                snapY = Math.round(otherBottom - item.height);
                guides.y = Math.round(otherBottom);
            } else if (Math.abs(itemCenterY - otherMiddle) < threshold) {
                snapY = Math.round(otherMiddle - item.height / 2);
                guides.y = Math.round(otherMiddle);
            }
        });

        return {
            x: clamp(snapX, 0, BASE_WIDTH - item.width),
            y: clamp(snapY, 0, BASE_HEIGHT - item.height),
            guides: guides
        };
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

    function applySlideTheme(slide, target) {
        if (!target) return;
        const theme = String(slide && slide.theme || 'light').toLowerCase();
        const palette = getThemePalette(theme);
        target.style.background = palette.bg;
    }

    function getThemePalette(theme) {
        const themeMap = {
            light: { bg: '#ffffff', text: '#1c1d1f' },
            dark: { bg: '#1c1d1f', text: '#ffffff' },
            purple: { bg: '#f3e8ff', text: '#4c1d95' },
            blue: { bg: '#e0f2fe', text: '#1d4ed8' }
        };
        const key = String(theme || 'light').toLowerCase();
        return themeMap[key] || themeMap.light;
    }
})();
