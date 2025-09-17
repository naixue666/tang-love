const i18n = {
    translations: {},
    currentLang: '',
    defaultLang: 'en',
    cache: new Map(), // 内存缓存
    initialized: false,
    fallbackChain: new Map(),
    preloadedLangs: [], // 已预加载的语言
    loadingPromises: new Map(), // 正在加载的语言承诺，避免重复请求
    criticalKeys: new Set(['pageTitle', 'greeting', 'confirmButton', 'questionTemplate']), // 关键内容键
    loadTimeout: 3000, // 加载超时时间（毫秒）

    // 初始化语言
    async init() {
        console.info('(开始初始化语言环境) | Starting to initialize the language environment');
        
        // 设置语言回退链
        this.setFallbackChain();
        
        // 优先使用用户偏好，其次是浏览器语言，最后是默认语言
        const userPref = localStorage.getItem('userLangPreference');
        const browserLang = navigator.language || this.defaultLang;
        console.info(`(检测到原始浏览器语言: ${browserLang}) | Detected original browser language: ${browserLang}`);
        
        // 尝试找到可用的语言代码
        this.currentLang = this.findAvailableLanguage(userPref || browserLang);
        console.info(`(最终使用的语言: ${this.currentLang}) | Final language to be used: ${this.currentLang}`);
        
        try {
            // 首先尝试从localStorage加载缓存
            const hasCached = this.loadFromLocalStorage(this.currentLang);
            if (hasCached) {
                console.info(`(从localStorage加载缓存的语言: ${this.currentLang}) | Loaded cached language from localStorage: ${this.currentLang}`);
                this.applyCriticalTranslations(); // 先应用关键内容
                // 后台异步刷新缓存
                this.refreshTranslationsInBackground(this.currentLang);
            } else {
                // 设置加载超时
                const loadPromise = this.loadTranslationsWithTimeout(this.currentLang);
                await loadPromise;
                console.info(`(成功加载 ${this.currentLang} 语言文件) | Successfully loaded the ${this.currentLang} language file`);
                // 保存到localStorage
                this.saveToLocalStorage(this.currentLang);
            }
        } catch (error) {
            console.warn(`(加载 ${this.currentLang} 语言文件失败，默认加载 ${this.defaultLang}.json) | Failed to load the ${this.currentLang} language file, loading ${this.defaultLang}.json by default`);
            try {
                await this.loadTranslationsWithTimeout(this.defaultLang);
                this.saveToLocalStorage(this.defaultLang);
            } catch (defaultError) {
                console.error(`(加载默认语言也失败) | Failed to load default language as well`);
                // 使用硬编码的最小化默认翻译作为最后的回退
                this.useMinimalFallbackTranslations();
            }
        }

        this.applyTranslations();
        console.info('(已应用语言翻译到页面) | Applied language translations to the page');
        this.initialized = true;
        
        // 预加载其他常用语言
        this.preloadPopularLanguages(['en', 'zh-CN', 'zh-TW', 'ja', 'ko']);
        
        return this.translations;
    },

    // 设置语言回退链
    setFallbackChain() {
        this.fallbackChain.set('zh-CN', ['zh-CN', 'zh']);
        this.fallbackChain.set('zh-TW', ['zh-TW', 'zh']);
        this.fallbackChain.set('en-US', ['en-US', 'en']);
        this.fallbackChain.set('en-GB', ['en-GB', 'en']);
    },

    // 查找可用的语言代码
    findAvailableLanguage(langCode) {
        // 简单的语言代码处理，如 en-US -> en
        const baseLang = langCode.split('-')[0];
        
        // 检查是否有对应的回退链
        if (this.fallbackChain.has(langCode)) {
            return langCode;
        }
        
        // 检查是否有基础语言的回退链
        if (this.fallbackChain.has(baseLang)) {
            return baseLang;
        }
        
        return langCode;
    },

    // 带超时的语言加载
    async loadTranslationsWithTimeout(lang) {
        // 检查是否已经有加载中的请求
        if (this.loadingPromises.has(lang)) {
            return this.loadingPromises.get(lang);
        }
        
        // 创建带超时的Promise
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`加载超时: ${lang}`)), this.loadTimeout);
        });
        
        const loadPromise = Promise.race([this.loadTranslations(lang), timeoutPromise]);
        
        // 存储正在加载的Promise
        this.loadingPromises.set(lang, loadPromise);
        
        try {
            await loadPromise;
        } finally {
            // 无论成功失败都从loadingPromises中移除
            this.loadingPromises.delete(lang);
        }
        
        return loadPromise;
    },

    // 加载语言文件 | 缓存支持
    async loadTranslations(lang) {
        // 检查内存缓存
        if (this.cache.has(lang)) {
            console.info(`(从内存缓存加载语言: ${lang}) | Loading language from memory cache: ${lang}`);
            this.translations = this.cache.get(lang);
            return;
        }

        const filePath = `i18n/${lang}.json`;
        console.info(`(尝试加载语言文件路径: ${filePath}) | Trying to load the language file from path: ${filePath}`);
        
        try {
            // 优化fetch请求
            const response = await fetch(filePath, {
                method: 'GET',
                cache: 'force-cache', // 优先使用缓存
                credentials: 'omit',
                keepalive: true // 允许请求在页面卸载后继续
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            // 使用流式解析（如果支持）
            this.translations = await response.json();
            
            // 存入内存缓存
            this.cache.set(lang, this.translations);
            console.info(`(成功加载并缓存语言: ${lang}) | Successfully loaded and cached language: ${lang}`);
        } catch (error) {
            console.error(`(解析 ${lang}.json 文件时出错: ${error.message}) | Error parsing the ${lang}.json file: ${error.message}`, error);
            
            // 尝试回退到基础语言
            const baseLang = lang.split('-')[0];
            if (baseLang !== lang) {
                console.warn(`(尝试回退到基础语言: ${baseLang}) | Trying to fall back to base language: ${baseLang}`);
                if (this.cache.has(baseLang)) {
                    this.translations = this.cache.get(baseLang);
                    return;
                }
                try {
                    await this.loadTranslations(baseLang);
                    return;
                } catch (fallbackError) {
                    console.error(`(回退到基础语言失败: ${baseLang}) | Failed to fall back to base language: ${baseLang}`);
                }
            }
            
            throw new Error(`(加载 ${lang} 失败) | Failed to load ${lang}`);
        }
    },

    // 从localStorage加载缓存
    loadFromLocalStorage(lang) {
        try {
            const cacheKey = `i18n_${lang}`;
            const cachedData = localStorage.getItem(cacheKey);
            
            if (cachedData) {
                const parsedData = JSON.parse(cachedData);
                this.translations = parsedData;
                this.cache.set(lang, parsedData);
                return true;
            }
        } catch (error) {
            console.error(`(从localStorage加载失败: ${error.message}) | Failed to load from localStorage: ${error.message}`);
        }
        return false;
    },

    // 保存到localStorage
    saveToLocalStorage(lang) {
        try {
            const cacheKey = `i18n_${lang}`;
            // 设置一个月的过期时间
            const cacheData = {
                ...this.translations,
                __timestamp: Date.now(),
                __ttl: 30 * 24 * 60 * 60 * 1000 // 30天
            };
            localStorage.setItem(cacheKey, JSON.stringify(cacheData));
        } catch (error) {
            console.error(`(保存到localStorage失败: ${error.message}) | Failed to save to localStorage: ${error.message}`);
        }
    },

    // 后台刷新缓存
    async refreshTranslationsInBackground(lang) {
        try {
            // 延迟执行以避免阻塞主线程
            setTimeout(async () => {
                try {
                    await this.loadTranslations(lang);
                    this.saveToLocalStorage(lang);
                    this.applyTranslations(); // 刷新页面翻译
                    console.info(`(后台成功刷新 ${lang} 语言缓存) | Successfully refreshed ${lang} language cache in background`);
                } catch (error) {
                    console.warn(`(后台刷新缓存失败，继续使用旧缓存) | Failed to refresh cache in background, continuing with old cache`);
                }
            }, 1000);
        } catch (error) {
            console.error(`(后台刷新过程出错: ${error.message}) | Error during background refresh: ${error.message}`);
        }
    },

    // 预加载常用语言
    preloadPopularLanguages(langCodes) {
        if (!langCodes || !langCodes.length) return;
        
        try {
            // 使用requestIdleCallback在浏览器空闲时预加载
            if ('requestIdleCallback' in window) {
                window.requestIdleCallback(() => {
                    langCodes.forEach(lang => {
                        if (lang !== this.currentLang && !this.preloadedLangs.includes(lang)) {
                            this.preloadedLangs.push(lang);
                            // 使用低优先级加载
                            this.loadTranslations(lang).catch(err => {
                                console.warn(`(预加载 ${lang} 失败: ${err.message}) | Failed to preload ${lang}: ${err.message}`);
                            });
                        }
                    });
                }, { timeout: 5000 });
            } else {
                // 不支持requestIdleCallback时的降级方案
                setTimeout(() => {
                    langCodes.forEach(lang => {
                        if (lang !== this.currentLang && !this.preloadedLangs.includes(lang)) {
                            this.preloadedLangs.push(lang);
                            this.loadTranslations(lang).catch(err => {
                                console.warn(`(预加载 ${lang} 失败: ${err.message}) | Failed to preload ${lang}: ${err.message}`);
                            });
                        }
                    });
                }, 2000);
            }
        } catch (error) {
            console.error(`(预加载语言过程出错: ${error.message}) | Error during language preloading: ${error.message}`);
        }
    },

    // 应用关键翻译（立即显示重要内容）
    applyCriticalTranslations() {
        console.info('(开始应用关键语言翻译) | Starting to apply critical language translations');
        
        // 先更新页面标题
        if (this.translations.pageTitle) {
            document.title = this.translations.pageTitle;
        }
        
        // 应用关键内容翻译
        const elements = document.querySelectorAll('[data-i18n]');
        elements.forEach((element) => {
            const key = element.getAttribute('data-i18n');
            if (this.criticalKeys.has(key) && this.translations[key]) {
                element.textContent = this.translations[key];
                console.debug(`(已将关键翻译 ${key} 应用到元素) | Applied critical translation of ${key} to the element`);
            }
        });
    },

    // 应用所有翻译
    applyTranslations() {
        console.info('(开始应用语言翻译到页面元素) | Starting to apply language translations to page elements');
        const elements = document.querySelectorAll('[data-i18n]');
        
        elements.forEach((element) => {
            const key = element.getAttribute('data-i18n');
            const translation = this.translations[key];
            
            if (translation) {
                // 直接更新元素的textContent
                element.textContent = translation;
                console.debug(`(已将 ${key} 翻译应用到元素) | Applied the translation of ${key} to the element`);
            }
        });
        
        console.info('(已应用语言翻译到页面) | Applied language translations to the page');
    },

    // 切换语言 | 优化版
    async switchLanguage(lang) {
        console.info(`(开始切换语言到 ${lang}) | Starting to switch the language to ${lang}`);
        
        // 避免频繁切换
        if (lang === this.currentLang && this.initialized) {
            console.info(`(语言已为 ${lang}，无需切换) | Language is already ${lang}, no need to switch`);
            return;
        }
        
        this.currentLang = lang;
        localStorage.setItem('userLangPreference', lang);
        
        // 显示加载指示器（如果有）
        this.showLoadingIndicator(true);
        
        try {
            await this.loadTranslationsWithTimeout(lang);
            this.saveToLocalStorage(lang);
            this.applyTranslations();
            console.info(`(已成功切换语言到 ${lang}) | Successfully switched the language to ${lang}`);
        } finally {
            // 隐藏加载指示器
            this.showLoadingIndicator(false);
        }
    },

    // 显示/隐藏加载指示器
    showLoadingIndicator(show) {
        // 可以根据实际项目添加加载指示器的实现
        console.debug(`(显示加载指示器: ${show}) | Show loading indicator: ${show}`);
    },

    // 使用最小化的回退翻译（当所有加载都失败时）
    useMinimalFallbackTranslations() {
        console.warn('(使用最小化回退翻译) | Using minimal fallback translations');
        this.translations = {
            pageTitle: 'Will you be my sweetheart?',
            greeting: 'What should I call you?',
            confirmButton: 'Confirm',
            questionTemplate: '{username}? Will you be my love?',
            loveMessage: 'I love you! {username}',
            yesButton: 'Yes!',
            noButton: 'No...',
            noTexts: [
                'Wait, really?',
                'My heart is cracking...',
                'Please think again!',
                'I\'ll cry a river...',
                'Final answer?'
            ]
        };
    },

    // 优化的模板替换函数
    template(str, data) {
        console.debug('(开始执行模板替换操作) | Starting the template replacement operation');
        
        // 性能优化：使用函数缓存
        if (!this.templateCache) {
            this.templateCache = new Map();
        }
        
        // 检查是否有编译过的模板
        let compiledTemplate = this.templateCache.get(str);
        if (!compiledTemplate) {
            // 编译模板
            compiledTemplate = (data) => {
                return str.replace(/\{([^{}]+)\}/g, (match, key) => {
                    const value = data[key] || '';
                    console.debug(`(替换模板中的 ${key} 为: ${value}) | Replaced ${key} in the template with: ${value}`);
                    return value;
                });
            };
            this.templateCache.set(str, compiledTemplate);
        }
        
        return compiledTemplate(data);
    },

    // 添加获取翻译的快捷方法
    t(key, data = {}) {
        const translation = this.translations[key];
        if (!translation) {
            console.warn(`(未找到翻译键: ${key}) | Translation key not found: ${key}`);
            return key; // 返回键本身作为回退
        }
        
        // 如果有数据，则进行模板替换
        return Object.keys(data).length > 0 ? this.template(translation, data) : translation;
    }
};

// 初始化语言选择器 | Initialize the language selector
async function initLanguageSwitcher() {
    console.info('(开始初始化语言选择器) | Starting to initialize the language selector');
    const select = document.getElementById('languageSelect');
    const response = await fetch('languages.json');
    const languages = await response.json();
    console.info('(成功获取语言列表) | Successfully retrieved the language list');
    const userPref = localStorage.getItem('userLangPreference');
    const browserLang = navigator.language || 'en';
    const defaultLang = browserLang || userPref;

    for (const [code, data] of Object.entries(languages)) {
        const option = new Option(data.label, code);
        option.selected = code === defaultLang;
        select.appendChild(option);
        console.debug(`(已添加语言选项: ${code} - ${data.label}) | Added language option: ${code} - ${data.label}`);
    }

    select.addEventListener('change', async (e) => {
        const langCode = e.target.value;
        console.info(`(用户选择了语言: ${langCode}) | User selected the language: ${langCode}`);
        await i18n.switchLanguage(langCode);
    });
    console.info('(语言选择器初始化完成) | Language selector initialization completed');
}

// 页面加载完成后执行初始化操作 | Perform initialization operations after the page is loaded
document.addEventListener('DOMContentLoaded', async () => {
    console.info('(页面加载完成，开始初始化操作) | Page loaded, starting initialization operations');
    // 初始化语言环境
    await i18n.init();
    // 初始化语言选择器
    await initLanguageSwitcher();

    // 获取元素引用 | Get elements
    const elements = {
        nameInput: document.getElementById('usernameInput'),
        confirmButton: document.getElementById('confirmNameButton'),
        questionText: document.getElementById('question'),
        yesButton: document.getElementById('yes'),
        noButton: document.getElementById('no'),
        nameInputContainer: document.getElementById('nameInputContainer'),
        confessionContainer: document.getElementById('confessionContainer'),
        mainImage: document.getElementById('mainImage')
    };
    console.info('(已获取页面元素引用) | Successfully obtained references to page elements', elements);

    // 显示输入容器 | Show input container
    elements.nameInputContainer.style.display = 'block';
    console.info('(已显示姓名输入容器) | Displayed the name input container');

    // 确认按钮事件  | Event of button
    elements.confirmButton.addEventListener('click', () => {
        console.info('(用户点击了确认按钮) | User clicked the confirm button');
        const username = elements.nameInput.value.substring(0, 20);
        elements.questionText.innerHTML = i18n.template(
            i18n.translations.questionTemplate,
            { username: username || '' }
        );
        console.info(`(已将用户名 ${username} 插入到表白问题中) | Inserted the username ${username} into the confession question`);
        elements.nameInputContainer.style.display = 'none';
        elements.confessionContainer.style.display = 'block';
        console.info('(隐藏姓名输入容器，显示表白内容容器) | Hidden the name input container and displayed the confession content container');
        // 给按钮容器添加动画类名 | Add animation class name to the button container
        elements.confessionContainer.querySelector('.buttons').classList.add('slide-up-fade-in');
        console.info('(已为按钮容器添加动画效果) | Added animation effect to the button container');
    });

    let clickCount = 0; // 记录点击 No 的次数 | Record the number of clicks on the No button
    // No 按钮点击事件 | No button click event
    elements.noButton.addEventListener('click', function () {
        clickCount++;
        console.info(`(用户点击了 No 按钮，点击次数: ${clickCount}) | User clicked the No button, click count: ${clickCount}`);
        // 让 Yes 变大，每次放大 2 倍 | Make Yes button bigger, double the size each time
        let yesSize = 1 + clickCount * 1.2;
        elements.yesButton.style.transform = `scale(${yesSize})`;
        console.info(`(将 Yes 按钮放大到 ${yesSize} 倍) | Scaled the Yes button to ${yesSize} times`);
        // 挤压 No 按钮，每次右移 50px | Squeeze the No button and move it 50px to the right each time
        let noOffset = clickCount * 50;
        elements.noButton.style.transform = `translateX(${noOffset}px)`;
        console.info(`(将 No 按钮右移 ${noOffset}px) | Moved the No button ${noOffset}px to the right`);
        // 让图片和文字往上移动 | Move the image and text up
        let moveUp = clickCount * 25;
        elements.mainImage.style.transform = `translateY(-${moveUp}px)`;
        elements.questionText.style.transform = `translateY(-${moveUp}px)`;
        console.info(`(将图片和文字上移 ${moveUp}px) | Moved the image and text up by ${moveUp}px`);
        // 更新 No 按钮文字（前 5 次） | Update the text of the No button (first 5 times)
        if (i18n.translations.noTexts && clickCount <= i18n.translations.noTexts.length) {
            elements.noButton.innerText = i18n.translations.noTexts[clickCount - 1];
            console.info(`(更新 No 按钮文字为: ${elements.noButton.innerText}) | Updated the text of the No button to: ${elements.noButton.innerText}`);
        }
        // 使用映射更新图片 | Update the image using the mapping
        const imageMap = {
            1: "assets/images/shocked.webp",  // 震惊
            2: "assets/images/think.webp",    // 思考
            3: "assets/images/angry.webp",    // 生气
            4: "assets/images/crying.webp",   // 哭
        };
        if (clickCount in imageMap) {
            elements.mainImage.src = imageMap[clickCount];
            console.info(`(将主图片更新为: ${imageMap[clickCount]}) | Updated the main image to: ${imageMap[clickCount]}`);
        } else if (clickCount >= 5) {
            elements.mainImage.src = "assets/images/crying.webp";
            console.info('(将主图片更新为哭泣图片) | Updated the main image to the crying image');
        }
    });

    // Yes 按钮点击事件，进入表白成功页面 | Yes button click event, enter the successful confession page
    const loveTest = (username) => i18n.template(i18n.translations.loveMessage, { username: username });
    elements.yesButton.addEventListener('click', function () {
        console.info('(用户点击了 Yes 按钮) | User clicked the Yes button');
        const username = elements.nameInput.value.substring(0, 20);
        // 确保用户名安全地插入 | Ensure the username is inserted safely
        document.body.innerHTML = `
            <div class="yes-screen">
                <h1 class="yes-text"></h1>
                <img src="assets/images/hug.webp" alt="Hug" class="yes-image">
            </div>
        `;
        console.info('(已替换页面内容为表白成功页面) | Replaced the page content with the successful confession page');
        // 确保用户名安全地插入
        document.querySelector(".yes-text").innerText = loveTest(username);
        console.info(`(已将用户名 ${username} 插入到表白成功信息中) | Inserted the username ${username} into the successful confession message`);
        // 禁止滚动，保持页面美观 | Disable scrolling to keep the page beautiful
        document.body.style.overflow = "hidden";
        console.info('(已禁止页面滚动) | Disabled page scrolling');
        // 给表白成功页面添加慢慢浮现动画类名 | Add a fade-in animation class name to the successful confession page
        document.querySelector('.yes-screen').classList.add('fade-in');
        console.info('(已为表白成功页面添加渐显动画效果) | Added fade-in animation effect to the successful confession page');
    });
});
