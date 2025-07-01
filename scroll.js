class ParallaxController {
    constructor(sectionSelector = '.parallax-section') {
        this.sectionSelector = sectionSelector;
        this.sections = Array.from(document.querySelectorAll(sectionSelector));
        this.elements = [];
        this.ticking = false;
        this.resizeTimeout = null;
        this.rafId = null;
        this.observer = null;
        this.isScrolling = false;
        this.scrollTimeout = null;
        this.state = {
            isInitialized: false,
            isAnimating: false,
            viewportHeight: window.innerHeight
        };

        this.handleResize = this.handleResize.bind(this);
        this.updateParallax = this.updateParallax.bind(this);
        this.handleIntersection = this.handleIntersection.bind(this);
        this.handleScroll = this.handleScroll.bind(this);
    }

    /**
     * Waits for all images within the parallax sections to be fully loaded.
     * This is the critical step to prevent layout shifts and calculation errors.
     */
    async waitForImages() {
        const imagePromises = [];
        this.sections.forEach(section => {
            const images = section.querySelectorAll('img');
            images.forEach(img => {
                const promise = new Promise((resolve) => {
                    if (img.complete && img.naturalHeight !== 0) {
                        resolve();
                    } else {
                        img.addEventListener('load', resolve, { once: true });
                        img.addEventListener('error', resolve, { once: true }); // Resolve on error too
                    }
                });
                imagePromises.push(promise);
            });
        });
        await Promise.all(imagePromises);
    }

    /**
     * Gathers data about each parallax element AFTER images are loaded.
     */
    setupElements() {
        if (!this.state.isInitialized) {
            this.state.isInitialized = true; // Allow first setup
        }
        try {
            this.elements = [];
            const parallaxItems = document.querySelectorAll('[data-parallax]');
            parallaxItems.forEach(item => {
                // Reset transform before measuring
                item.style.transform = '';
                // Force reflow
                item.offsetHeight;
                let speedAttr = item.dataset.parallaxSpeed || "0";
                let speed = 0;
                // Support CSS variable in data-parallax-speed
                if (speedAttr.startsWith("var(")) {
                    // Get computed value of the CSS variable
                    const varName = speedAttr.match(/var\((--[^)]+)\)/)?.[1];
                    if (varName) {
                        const computed = getComputedStyle(item).getPropertyValue(varName).trim();
                        speed = parseFloat(computed) || 0;
                    }
                } else {
                    speed = parseFloat(speedAttr) || 0;
                }
                this.elements.push({
                    element: item,
                    speed: speed,
                    // Get initial top position relative to the document
                    initialTop: item.getBoundingClientRect().top + window.scrollY,
                    height: item.offsetHeight,
                    isVisible: false,
                });
            });
        } catch (error) {
            console.error('ParallaxController setup failed:', error);
            this.elements = [];
        }
    }

    /**
     * Binds scroll and resize event listeners.
     */
    bindEvents() {
        window.addEventListener('scroll', this.handleScroll, { passive: true });
        window.addEventListener('resize', this.handleResize);
    }

    observeElements() {
        if (this.observer) this.observer.disconnect();
        this.observer = new IntersectionObserver(this.handleIntersection, {
            root: null,
            rootMargin: '100px',
            threshold: [0, 0.1, 0.5, 0.9, 1]
        });
        this.elements.forEach(item => {
            this.observer.observe(item.element);
        });
    }

    handleIntersection(entries) {
        entries.forEach(entry => {
            const el = this.elements.find(e => e.element === entry.target);
            if (el) el.isVisible = entry.isIntersecting;
        });
    }

    /**
     * Debounces resize events to avoid excessive recalculations.
     */
    handleResize() {
        clearTimeout(this.resizeTimeout);
        this.resizeTimeout = setTimeout(() => {
            this.setupElements();
            this.observeElements();
        }, 250); // Wait 250ms after the last resize event
    }

    handleScroll() {
        if (!this.isScrolling) {
            this.isScrolling = true;
            this.updateParallax();
        }
        clearTimeout(this.scrollTimeout);
        this.scrollTimeout = setTimeout(() => {
            this.isScrolling = false;
            if (this.rafId) {
                cancelAnimationFrame(this.rafId);
                this.rafId = null;
            }
        }, 150);
    }

    /**
     * The core animation function.
     */
    updateParallax() {
        const startTime = performance.now();
        const viewportCenterY = window.scrollY + window.innerHeight / 2;
        const updates = [];
        let hasVisibleElements = false;

        // Group elements by section to pair image/content
        const sectionMap = new Map();
        this.elements.forEach(item => {
            const section = item.element.closest('.parallax-section');
            if (!section) return;
            if (!sectionMap.has(section)) sectionMap.set(section, []);
            sectionMap.get(section).push(item);
        });

        sectionMap.forEach(items => {
            // Find image and content in this section
            let image = items.find(i => i.element.classList.contains('parallax-image'));
            let content = items.find(i => i.element.classList.contains('parallax-content'));

            // Fallback: if not found, just process as before
            if (!image || !content) {
                items.forEach(item => {
                    const elementCenterY = item.initialTop + item.height / 2;
                    const distanceFromCenter = elementCenterY - viewportCenterY;
                    const movement = distanceFromCenter * item.speed;
                    updates.push({ element: item.element, movement });
                    if (item.isVisible) hasVisibleElements = true;
                });
                return;
            }

            // Calculate image movement as before
            const imageCenterY = image.initialTop + image.height / 2;
            const imageDistanceFromCenter = imageCenterY - viewportCenterY;
            const imageMovement = imageDistanceFromCenter * image.speed;
            updates.push({ element: image.element, movement: imageMovement });
            if (image.isVisible) hasVisibleElements = true;

            // For content: align its center with the image's center (when image is centered in viewport)
            // So, content movement = (imageCenterY - contentCenterY) + (imageDistanceFromCenter * content.speed)
            const contentCenterY = content.initialTop + content.height / 2;
            const centerOffset = imageCenterY - contentCenterY;
            const contentMovement = centerOffset + imageDistanceFromCenter * content.speed;
            updates.push({ element: content.element, movement: contentMovement });
            if (content.isVisible) hasVisibleElements = true;
        });

        // Batch DOM writes
        updates.forEach(({ element, movement }) => {
            element.style.transform = `translateY(${movement}px)`;
        });

        if (hasVisibleElements) {
            this.rafId = requestAnimationFrame(this.updateParallax);
        } else {
            this.rafId = null;
        }

        const endTime = performance.now();
        if (endTime - startTime > 16) {
            console.warn(`Parallax frame took ${endTime - startTime}ms`);
        }
    }

    /**
     * Initializes the entire system in the correct order.
     */
    async init() {
        this.sections = Array.from(document.querySelectorAll(this.sectionSelector));
        if (this.sections.length === 0) return;

        await this.waitForImages();
        this.setupElements();
        this.observeElements();
        this.bindEvents();
        // Do not start animation loop until scroll event
        // Optionally, you can call this.updateParallax() once here if you want initial positions set
        this.updateParallax();
    }

    /**
     * Cleans up all event listeners and timeouts for memory management.
     */
    destroy() {
        window.removeEventListener('resize', this.handleResize);
        window.removeEventListener('scroll', this.handleScroll);
        clearTimeout(this.resizeTimeout);
        clearTimeout(this.scrollTimeout);
        if (this.rafId) cancelAnimationFrame(this.rafId);
        if (this.observer) this.observer.disconnect();
    }
}

// Instantiate and initialize the controller
const parallax = new ParallaxController();
window.parallax = parallax; // Expose to window for inline script

// Remove the immediate call to parallax.init(); 
// It will be called from the inline script in the HTML after images are loaded