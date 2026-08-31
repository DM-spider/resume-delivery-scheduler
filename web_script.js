// ==UserScript==
// @name         goodJobs
// @namespace    http://tampermonkey.net/
// @version      2025-02-15
// @description  goodJobs篡改猴插件
// @match        https://www.zhipin.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=zhipin.com
// @grant        GM.xmlHttpRequest
// @connect      127.0.0.1
// @connect      localhost
// ==/UserScript==

(function () {
    'use strict';

    // 配置项
    const OPTIONS = {
        resumeIndex: 0, // 第几份简历，从 0 开始递增
        serverHost: 'http://127.0.0.1:8000', // 本地服务的主机地址
        thread: 50, // 分数阈值，低于这个就不发消息了
        timestampTimeout: 3000, // 时间戳过期时间，单位毫秒，根据当前网络设定，建议不要太大。
        onlyGreet: false, // 是否只打招呼，默认为false，即打招呼和代聊天
        manualFilterWaitMs: 10000, // 每轮搜索后留给用户手动筛选的时间
        roundRestartDelayMs: 2000, // 本轮结束后，启动下一轮前的缓冲时间
        maxEmptyRounds: 3, // 连续多少轮没有拿到新岗位后停止，避免空转
        maxJobsPerRun: 200, // 单次运行最多打开并评分多少个真实 JD，0 表示不限量
        detailTimeout: 10000, // 获取职位详情超时时间
        greetTimeout: 12000, // 打招呼页回执超时时间
        preloadScrollPixels: 180, // 岗位预加载：每轮下滑像素
        preloadScrollWaitMs: 450, // 岗位预加载：每轮等待毫秒数
        preloadStableRoundsLimit: 24, // 岗位预加载：连续多少轮无增长后结束
        preloadMaxRounds: 300, // 岗位预加载：最多滑动多少轮
        preloadActivateCardEvery: 0, // 预加载时每隔多少轮尝试轻点一次左侧岗位卡片，0 表示关闭
        preloadActivateCardWaitMs: 250, // 轻点岗位卡片后的额外等待时间
    };

    // 元素选择器
    const SELECTORS = {
        ZHIPIN: {
            SEARCH: {
                SEARCHINPUT: 'input', // 搜索框
                SEARCHBTN: '.search-btn', // 搜索按钮
                JOBLISTCTN: '.job-list-container', // 职位列表容器
                JOBLIST: '.rec-job-list', // 职位列表
                JOBCARD: '.job-card-box', // 左侧岗位卡片
                JOBHREFS: '.job-card-box .job-name', // 职位链接
            },
            DETAIL: {
                STARTCHAT: '.btn-startchat', // 开始聊天按钮
                NAMEBOX: '.name', // 职位名称盒子
                JOBNAME: 'h1', // 职位名称
                SALARY: '.salary', // 职位薪资
                DETAIL: '.job-sec-text', // 职位详情
                CHATURL: 'redirect-url', // 聊天链接
            },
            CHAT: {
                // 聊天
                CHATINPUT: '#chat-input', // 聊天输入框
                MSGSEND: '.btn-send', // 消息发送按钮
                // 聊天记录
                HISTORYCTN: '.chat-message', // 聊天记录容器
                USEFULMSG: '.item-friend,.item-myself', // 有效的文字聊天记录项
                MSGCONTENT: '.message-content .text', // 聊天记录内容
                // 简历
                RESUMESEND: '.toolbar-btn.tooltip.tooltip-top', // 简历发送按钮
                RESUMEMODAL: '.panel-resume', // 简历发送弹窗，有的时候简历按钮点击会出来一个小弹窗
                RESUMEMODALCONFIRM: '.btn-sure-v2', // 简历发送弹窗确认按钮
                RESUMELIST: '.resume-list', // 简历列表
                RESUMELISTITEM: 'li', // 简历列表项
                RESUMESENDCONFIRM: '.btn-confirm', // 简历发送确认按钮
                // 联系人
                CONTACTLISTEMPTY: '.no-data', // 联系人列表为空
                CONTACTLIST: '.user-list-content', // 联系人列表
                CONTACTLISTITEM: 'li', // 联系人列表项
                NEWMSGNOTICE: '.notice-badge', // 新消息通知图标
                USERNAME: '.name-text', // 联系人名称
            }
        },
    };

    // 搜索路径
    const SEARCHPATH = {
        zhipin: '/web/geek/job',
    };

    // 白名单
    const WHITELIST = {
        zhipin: {
            deatil: '/job_detail',
            chat: '/web/geek/chat'
        },
    };

    // 工具
    const tools = {
        inWhiteList: function (pathObj) {
            return Object.values(pathObj).some((path) => location.pathname.startsWith(path));
        },
        endlessFind: function (selector) {
            return new Promise((resolve, reject) => {
                // 初始立即检查元素是否存在
                let element;
                try {
                    element = document.querySelector(selector);
                } catch (e) {
                    reject(e); // 处理无效选择器
                    return;
                }
                if (element) {
                    resolve(element);
                    return;
                }

                // 设置超时
                const timeoutId = setTimeout(() => {
                    observer.disconnect();
                    reject(new Error('未找到目标元素'));
                }, 10000);

                // 定义MutationObserver回调
                const observer = new MutationObserver((_, obs) => {
                    try {
                        const el = document.querySelector(selector);
                        if (el) {
                            obs.disconnect();
                            clearTimeout(timeoutId);
                            resolve(el);
                        }
                    } catch (e) {
                        obs.disconnect();
                        clearTimeout(timeoutId);
                        reject(e);
                    }
                });

                // 开始观察整个文档的DOM变化
                observer.observe(document.documentElement, {
                    childList: true,
                    subtree: true
                });
            });
        },
        inputText: function (el, text) {
            el.value = text;
            el.dispatchEvent(new Event('input', { bubbles: true }));
        },
        asyncSleep(ms) {
            return new Promise((resolve) => {
                // 创建一个 Blob 对象，包含 Web Worker 的代码
                const workerCode = `self.addEventListener('message', function(e) {
                    const delay = e.data;
                    setTimeout(function() {
                        self.postMessage('done');
                    }, delay);
                });`;

                const blob = new Blob([workerCode], { type: 'application/javascript' });
                const workerUrl = URL.createObjectURL(blob);

                const worker = new Worker(workerUrl);
                worker.onmessage = function () {
                    resolve();
                    worker.terminate(); // 使用后终止worker
                    URL.revokeObjectURL(workerUrl); // 释放对象URL
                };
                worker.postMessage(ms);
            });
        },
        getTimestamp(key) {
            return Number(localStorage.getItem(key));
        },
        openTabNSetTimestamp(href, key, self = false) {
            localStorage.setItem(key, new Date().getTime());
            window.open(href, self ? '_self' : key);
        },
    };

    /**
     * 横幅
     * @param {string} text 显示的文本
     */
    function banner(text) {
        const el = document.createElement('div');
        el.style.cssText = `
                position: fixed;
                top: 60px;
                left: 50%;
                transform: translateX(-50%);
                z-index: 9999;
                background-color: rgba(0,0,0,.5);
                padding: 4px 20px;
                text-align: center;
                border-radius: 8px;
                color: #fff;
        `;
        el.innerText = text;
        document.body.appendChild(el);
        setTimeout(function () {
            el.remove();
        }, 3000);
    }

    /**
     * 转换时间
     * @param {number} seconds 秒数
     * @returns {string} 转换后的时间字符串
     */
    function convertTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        return `${hours.toString().padStart(2, 0)
            } : ${minutes.toString().padStart(2, 0)
            } : ${secs.toFixed(0).padStart(2, 0)
            }`;
    }


    class WebBroadcastError extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
            this.name = 'WebBroadcastError';
        }
    }

    class WebBroadcast {
        static ID_COUNTER = 0; // 自增序列，避免时间戳冲突

        /**
         * @param {string} name 频道名称
         * @param {string} target 当前页面标识
         * @param {object} [options] 配置项
         * @param {number} [options.retry=3] 发送失败重试次数
         * @param {number} [options.retryInterval=1000] 重试间隔(毫秒)
         */
        constructor(name, target, options = {}) {
            this.name = name;
            this.target = target;
            this.retry = options.retry ?? 3;
            this.retryInterval = options.retryInterval ?? 1000;
            this.evts = {};
            this.pendingResponses = {};
            this.pendingReceives = {};

            // 初始化通信通道
            this.initChannel();
        }

        /* -------------------- 核心通信逻辑 -------------------- */
        initChannel() {
            // 优先使用 BroadcastChannel
            if (typeof BroadcastChannel !== 'undefined') {
                this.setupBroadcastChannel();
            } else {
                this.setupStorageFallback();
            }
            window.addEventListener('beforeunload', () => this.destroy());
        }

        setupBroadcastChannel() {
            this.channelType = 'broadcast';
            this.channel = new BroadcastChannel(this.name);
            this.channel.addEventListener('message', this.handleMessage.bind(this));
            this.channel.addEventListener('messageerror', (e) => {
                this.emitError('MESSAGE_ERROR', '消息解析失败', e);
            });
        }

        setupStorageFallback() {
            this.channelType = 'storage';
            this.storageKey = `web_broadcast_${this.name}`;

            // 监听 storage 事件
            window.addEventListener('storage', (e) => {
                if (e.key === this.storageKey && e.newValue) {
                    const message = JSON.parse(e.newValue);
                    this.handleMessage({ data: message });
                }
            });
        }

        handleMessage(e) {
            const resp = e.data;
            if (![this.target, 'all'].includes(resp.to)) return;

            // 处理事件监听
            if (this.evts[resp.type]) {
                Promise.resolve().then(() => this.evts[resp.type](resp.from, resp.data));
            }

            // 处理 receive 等待
            const receiveKey = `${resp.from}-${resp.type}`;
            if (this.pendingReceives[receiveKey]) {
                const pending = this.pendingReceives[receiveKey];
                pending.resolve(resp.data);
                clearTimeout(pending.timer);
                delete this.pendingReceives[receiveKey];
            }

            // 处理 sendAndReceive 响应
            if (this.pendingResponses[resp.data?.requestId]) {
                const pending = this.pendingResponses[resp.data.requestId];
                pending.resolve(resp.data);
                clearTimeout(pending.timer);
                delete this.pendingResponses[resp.data.requestId];
            }
        }

        /* -------------------- 消息收发方法 -------------------- */
        send(to, type, data = null, attempt = 0) {
            const message = { from: this.target, to, type, data };

            return new Promise((resolve, reject) => {
                try {
                    if (this.channelType === 'broadcast') {
                        this.channel.postMessage(message);
                    } else {
                        // storage 方案需要先写入再删除，触发事件
                        localStorage.setItem(this.storageKey, JSON.stringify(message));
                        localStorage.removeItem(this.storageKey);
                    }
                    resolve();
                } catch (err) {
                    if (attempt < this.retry) {
                        setTimeout(() => this.send(to, type, data, attempt + 1), this.retryInterval);
                    } else {
                        this.emitError('SEND_FAILED', `消息发送失败: ${type}`, err);
                        reject(`消息发送失败: ${type}, ${err.message}`);
                    }
                }
            });
        }

        receive(from, type, timeout = 30000) {
            const key = `${from}-${type}`;
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    reject(new WebBroadcastError('TIMEOUT', `接收超时: ${type}`));
                    delete this.pendingReceives[key];
                }, timeout);

                this.pendingReceives[key] = { resolve, reject, timer };
            });
        }

        sendAndReceive(to, type, data = null, timeout = 30000) {
            const requestId = this.generateRequestId();
            const responseType = `${type}_response`;

            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    reject(new WebBroadcastError('TIMEOUT', `请求超时: ${type}`));
                    delete this.pendingResponses[requestId];
                }, timeout);


                this.pendingResponses[requestId] = { resolve, reject, timer };
                // 发送时携带 responseType
                this.send(to, type, { ...data, requestId, responseType });
            });
        }

        reply(originalFrom, originalType, data, requestId, responseType) {
            const finalResponseType = responseType || `${originalType}_response`;
            return this.send(originalFrom, finalResponseType, { ...data, requestId });
        }

        /* -------------------- 工具方法 -------------------- */
        generateRequestId() {
            const time = Date.now().toString(36);
            const random = Math.random().toString(36).slice(2, 6);
            WebBroadcast.ID_COUNTER = (WebBroadcast.ID_COUNTER + 1) % 0xfff;
            return `${time}-${random}-${WebBroadcast.ID_COUNTER.toString(36).padStart(2, '0')}`;
        }

        emitError(code, message, error) {
            const err = new WebBroadcastError(code, `${message}: ${error?.message || error}`);
            console.error(err);
            if (this.evts['error']) {
                this.evts['error'](code, err.message);
            }
        }

        on(evt, fn) {
            if (typeof fn !== 'function') throw new Error('回调必须是函数');
            this.evts[evt] = fn;
        }

        off(evt) {
            delete this.evts[evt];
        }

        destroy() {
            if (this.channel) {
                this.channel.close();
            }
            window.removeEventListener('storage', this.handleMessage);
            this.pendingResponses = {};
            this.pendingReceives = {};
        }
    }

    // api请求
    class Api {
        constructor() { }

        /**
         * 封装请求
         * @param {string} path 请求路径
         * @param {string} method 请求方法
         * @param {any} data 请求数据
         * @returns {Promise<any>} 请求结果
         */
        __http(path, method = 'GET', data = null) {
            const start = performance.now();
            return new Promise(async (resolve, reject) => {
                GM.xmlHttpRequest({
                    method: method,
                    url: OPTIONS.serverHost + path,
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    data: data,
                    timeout: 1000 * 60 * 10,
                })
                    .then(resp => {
                        if (resp.status != 200) {
                            banner(`请求失败: ${resp.status}`);
                            reject(resp.status);
                            return;
                        }
                        resolve(JSON.parse(resp.response));
                    })
                    .catch((err) => {
                        banner('请求出错');
                        reject(`请求出错: ${JSON.stringify(err)}`);
                    });
            });
        }

        /**
         * 获取前端运行配置
         */
        getClientConfig() {
            return new Promise((resolve, reject) => this.__http('/client-config').then(resolve).catch(reject));
        }

        /**
         * 获取职位匹配度
         * @param {string} title 职位标题
         * @param {string} salary 薪资范围
         * @param {string} detail 职位描述
         */
        getJobScore(title, salary, detail) {
            const data = `# 职位名称\n${title}\n\n# 薪资范围\n${salary}\n\n# 职位描述\n${detail}`;
            return new Promise((resolve, reject) => {
                this.__http('/get-job-score', 'POST', JSON.stringify(data)).then(resolve).catch(reject);
            });
        }
    }

    // 日志记录
    class Logger {
        constructor(startFn, stopFn) {
            // 校验函数
            if (startFn && !Function.prototype.isPrototypeOf(startFn)) {
                throw new Error('参数错误，startFn应为函数');
            }
            if (stopFn && !Function.prototype.isPrototypeOf(stopFn)) {
                throw new Error('参数错误，stopFn应为函数');
            }
            // 创建元素
            const ctn = document.createElement('div');
            const btnBox = document.createElement('div');
            const clearBtn = document.createElement('div');
            const runBtn = document.createElement('div');
            const foldBtn = document.createElement('div');
            const msgList = document.createElement('div');
            ctn.style.cssText = `
                position: fixed;
                bottom: 16px;
                left: 16px;
                width: 380px;
                background-color: rgba(0, 0, 0, 0.5);
                color: #fff;
                z-index: 9999;
                font-size: 14px;
                border-radius: 10px;
            `;
            btnBox.style.cssText = `
                width: 380px;
                height: 32px;
                display: flex;
                align-items: center;
                justify-content: flex-end;
            `;
            clearBtn.style.cssText = runBtn.style.cssText = foldBtn.style.cssText = `
                width: 60px;
                height: 32px;
                line-height: 32px;
                text-align: center;
                cursor: pointer;
            `;
            msgList.style.cssText = `
                width: 380px;
                height: 240px;
                padding: 2px 12px 8px;
                overflow-y: auto;
                display: flex;
                flex-direction: column;
                gap: 4px;
            `;
            clearBtn.innerText = "清空";
            runBtn.innerText = "开始";
            foldBtn.innerText = "收起";
            document.body.appendChild(ctn);
            ctn.appendChild(btnBox);
            btnBox.appendChild(clearBtn);
            btnBox.appendChild(runBtn);
            btnBox.appendChild(foldBtn);
            ctn.appendChild(msgList);
            this.ctn = ctn;
            this.list = msgList;
            this.runBtn = runBtn;
            this.clearBtn = clearBtn;
            this.__startFn = startFn || (() => void 0);
            this.__stopFn = stopFn || (() => void 0);
            this.__running = false;
            clearBtn.addEventListener('click', () => this.clear());
            runBtn.addEventListener('click', () => {
                if (this.__running) {
                    this.setRunning(false);
                    this.__stopFn();
                } else {
                    this.setRunning(true);
                    this.__startFn();
                }
            });
            foldBtn.addEventListener('click', () => {
                if (foldBtn.innerText === "展开") {
                    msgList.style.height = "240px";
                    foldBtn.innerText = "收起";
                } else {
                    msgList.style.height = "32px";
                    this.list.scrollTop = this.list.scrollHeight;
                    foldBtn.innerText = "展开";
                }
            });
        }

        setRunning(running) {
            this.__running = running;
            this.runBtn.innerText = running ? "结束" : "开始";
        }

        stop() {
            if (!this.__running) return;
            this.setRunning(false);
            this.__stopFn();
        }

        add(message) {
            const item = document.createElement('div');
            item.textContent = message;
            this.list.appendChild(item);
            this.list.scrollTop = this.list.scrollHeight;
        }

        divider() {
            const item = document.createElement('div');
            item.style.cssText = `
                width: 100%;
                border-top: 1px dashed rgba(255, 255, 255, 0.6);
            `;
            this.list.appendChild(item);
            this.list.scrollTop = this.list.scrollHeight;
        }

        clear() {
            while (this.list.firstChild) {
                this.list.removeChild(this.list.firstChild);
            }
        }

        remove() {
            this.ctn.remove();
        }
    }

    // 小时调度器：计划只保存在当前脚本内存中，页面刷新即重置
    class HourlyScheduler {
        constructor(schedule) {
            this.schedule = schedule || {};
            // 状态：当前小时标识、时点列表、已消费位置
            this.hourKey = '';
            this.slots = [];
            this.cursor = 0;
            this.nextTestSlotMs = 0;
            this.currentStrategy = null;
        }

        // 工作日判断
        isWorkday(date) {
            const weekdays = Array.isArray(this.schedule.weekdays) && this.schedule.weekdays.length
                ? this.schedule.weekdays
                : [1, 2, 3, 4, 5];
            return weekdays.indexOf(date.getDay()) !== -1;
        }

        // 工作时段判断：startHour <= 当前小时 < endHour
        isWorkTime(date) {
            const startHour = typeof this.schedule.startHour === 'number' ? this.schedule.startHour : 9;
            const endHour = typeof this.schedule.endHour === 'number' ? this.schedule.endHour : 18;
            return this.isWorkday(date) && date.getHours() >= startHour && date.getHours() < endHour;
        }

        // 小时标识，用于判断是否进入新小时
        getHourKey(date) {
            return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}-${date.getHours()}`;
        }

        getStrategies() {
            const allStrategies = [
                { id: 'balanced', name: '均匀分散' },
                { id: 'front_loaded', name: '前密后疏' },
                { id: 'back_loaded', name: '前疏后密' },
                { id: 'two_waves', name: '双波段' },
                { id: 'mixed_cadence', name: '长短间隔混合' },
            ];
            const enabled = Array.isArray(this.schedule.strategies) ? this.schedule.strategies : [];
            const filtered = allStrategies.filter((strategy) => enabled.includes(strategy.id));
            return filtered.length ? filtered : allStrategies;
        }

        buildStratifiedOffsets(count, startMs, durationMs) {
            const segmentMs = durationMs / count;
            const offsets = [];
            for (let i = 0; i < count; i++) {
                offsets.push(startMs + i * segmentMs + Math.random() * segmentMs);
            }
            return offsets;
        }

        buildStrategyOffsets(strategyId, count) {
            const hourMs = 60 * 60 * 1000;
            if (strategyId === 'balanced') {
                return this.buildStratifiedOffsets(count, 0, hourMs);
            }
            if (strategyId === 'front_loaded' || strategyId === 'back_loaded') {
                const exponent = 1.65;
                const offsets = [];
                for (let i = 0; i < count; i++) {
                    const position = (i + Math.random()) / count;
                    const ratio = strategyId === 'front_loaded'
                        ? Math.pow(position, exponent)
                        : 1 - Math.pow(1 - position, exponent);
                    offsets.push(ratio * hourMs);
                }
                return offsets;
            }
            if (strategyId === 'two_waves') {
                const firstCount = Math.ceil(count / 2);
                const secondCount = count - firstCount;
                return [
                    ...this.buildStratifiedOffsets(firstCount, 2 * 60 * 1000, 20 * 60 * 1000),
                    ...this.buildStratifiedOffsets(secondCount, 34 * 60 * 1000, 24 * 60 * 1000),
                ];
            }

            // 混合节奏：同一小组内间隔 10-45 秒，小组之间自然形成数分钟间隔
            const shortGaps = [10, 20, 30, 45].map((seconds) => seconds * 1000);
            const clusterCount = Math.ceil(count / 2);
            const marginMs = 2 * 60 * 1000;
            const segmentMs = (hourMs - 2 * marginMs) / clusterCount;
            const offsets = [];
            for (let cluster = 0; cluster < clusterCount && offsets.length < count; cluster++) {
                const baseMs = marginMs + cluster * segmentMs + Math.random() * Math.min(segmentMs * 0.35, 90 * 1000);
                offsets.push(baseMs);
                if (offsets.length < count) {
                    const shortGap = shortGaps[Math.floor(Math.random() * shortGaps.length)];
                    offsets.push(baseMs + shortGap);
                }
            }
            return offsets;
        }

        // 每小时随机选择一种节奏，并生成 10-20 个有序时点
        buildSlots(hourStartMs) {
            const minPerHour = Math.max(1, this.schedule.minPerHour || 10);
            const maxPerHour = Math.max(minPerHour, this.schedule.maxPerHour || 20);
            const count = minPerHour + Math.floor(Math.random() * (maxPerHour - minPerHour + 1));
            const strategies = this.getStrategies();
            this.currentStrategy = strategies[Math.floor(Math.random() * strategies.length)];
            const slots = this.buildStrategyOffsets(this.currentStrategy.id, count)
                .map((offset) => hourStartMs + Math.min(offset, 60 * 60 * 1000 - 1));
            slots.sort((a, b) => a - b);
            return slots;
        }

        // 进入新小时时重建计划，已过去的时点直接作废
        ensurePlan(now, log) {
            const hourKey = this.getHourKey(now);
            if (hourKey === this.hourKey) return;
            const hourStart = new Date(now.getTime());
            hourStart.setMinutes(0, 0, 0);
            this.hourKey = hourKey;
            this.slots = this.buildSlots(hourStart.getTime());
            this.cursor = 0;
            while (this.cursor < this.slots.length && this.slots[this.cursor] <= now.getTime()) {
                this.cursor++;
            }
            if (log) log(`本小时策略 [${this.currentStrategy.name}]，计划 ${this.slots.length} 次打招呼尝试`);
        }

        // 丢弃当前计划
        reset() {
            this.hourKey = '';
            this.slots = [];
            this.cursor = 0;
            this.nextTestSlotMs = 0;
            this.currentStrategy = null;
        }

        // 下一个整点
        nextHourStart(nowMs) {
            const next = new Date(nowMs);
            next.setMinutes(0, 0, 0);
            next.setHours(next.getHours() + 1);
            return next.getTime();
        }

        // 下一个工作时段开始时间
        nextWorkStart(nowMs) {
            const startHour = typeof this.schedule.startHour === 'number' ? this.schedule.startHour : 9;
            const next = new Date(nowMs);
            next.setHours(startHour, 0, 0, 0);
            while (!this.isWorkday(next) || next.getTime() <= nowMs) {
                next.setDate(next.getDate() + 1);
                next.setHours(startHour, 0, 0, 0);
            }
            return next.getTime();
        }

        formatTime(ms) {
            const d = new Date(ms);
            const pad = (n) => String(n).padStart(2, '0');
            return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        }

        // 等到目标时间，分片睡眠；任务结束后尽快退出等待
        async sleepUntil(targetMs, isStopped = () => false) {
            while (true) {
                if (isStopped()) return false;
                const remaining = targetMs - Date.now();
                if (remaining <= 0) return true;
                await tools.asyncSleep(Math.min(remaining, 500));
            }
        }

        // 等待并消费下一个未来时点；任务结束期间到达的时点作废
        async waitForNextSlot(log, isPaused) {
            while (true) {
                if (isPaused()) return null;
                const testIntervalSeconds = Number(this.schedule.testIntervalSeconds) || 0;
                if (testIntervalSeconds > 0) {
                    const intervalMs = Math.max(1000, testIntervalSeconds * 1000);
                    const nowMs = Date.now();
                    if (!this.nextTestSlotMs || this.nextTestSlotMs <= nowMs) {
                        this.nextTestSlotMs = nowMs + intervalMs;
                    }
                    const slotMs = this.nextTestSlotMs;
                    log(`测试模式：下一次打招呼时间 ${this.formatTime(slotMs)}`);
                    if (!await this.sleepUntil(slotMs, isPaused)) return null;
                    this.nextTestSlotMs = slotMs + intervalMs;
                    log(`测试模式：执行一次打招呼尝试，间隔 ${testIntervalSeconds} 秒`);
                    return slotMs;
                }
                const now = new Date();
                // 非工作时间：等待下一个工作日 09:00
                if (!this.isWorkTime(now)) {
                    this.reset();
                    const nextMs = this.nextWorkStart(now.getTime());
                    const next = new Date(nextMs);
                    log(`当前不在工作时间，等待下一个工作日 ${next.getMonth() + 1}月${next.getDate()}日 ${this.formatTime(nextMs).slice(0, 5)}`);
                    if (!await this.sleepUntil(nextMs, isPaused)) return null;
                    continue;
                }
                this.ensurePlan(new Date(), log);
                // 当前小时没有剩余时点：等待下一个整点重新生成计划
                if (this.cursor >= this.slots.length) {
                    if (!await this.sleepUntil(this.nextHourStart(Date.now()), isPaused)) return null;
                    continue;
                }
                const slotMs = this.slots[this.cursor];
                // 过期时点直接作废
                if (slotMs <= Date.now()) {
                    this.cursor++;
                    continue;
                }
                log(`下一次计划时间 ${this.formatTime(slotMs)}`);
                if (!await this.sleepUntil(slotMs, isPaused)) return null;
                // 消费该时点，返回给调用方执行一次打招呼流程
                this.cursor++;
                log(`执行本小时第 ${this.cursor}/${this.slots.length} 次尝试`);
                return slotMs;
            }
        }
    }

    // boss 直聘
    class Zhipin {
        constructor() {
            // 窗口标签
            this.targets = {
                search: "__zhipin_search",
                detail: "__zhipin_detail",
                chat: "__zhipin_chat",
                chatGreet: "__zhipin_chat_greet",
            };
            // 广播类型
            this.bcTypes = {
                // 全局
                STATUS: "status",
                RUN: 'run',
                DIVIDER: 'divider',
                HEART_BEAT: 'heart-beat',
                // 聊天页和职位详情页
                GET_JOB_INFO: 'get-job-info',
                SAY_HI: 'say-hi',
            };
            // 白名单
            this.whiteList = WHITELIST.zhipin;
            // 记录状态
            this.pause = false;
            this.tags = [];
            this.introduce = ''
        }

        // 注册广播
        __broadcast(target) {
            this.broadcast = new WebBroadcast('__zhipin_broadcast', target);
        }

        // 搜索页
        async __search(tagIdx) {
            // api
            const api = new Api();
            // 记录开始时间
            const start = new Date().getTime();
            let count = 0;
            let page = 0;
            // 记录职位链接
            let jobHrefs = [];
            let elsLen = 0;
            // 缓存
            let started = false;
            let pendingRoundRestart = false;
            let roundTransitioning = false;
            let currentRound = 0;
            let emptyRounds = 0;
            let roundQueuedCount = 0;
            let currentKeyword = '';
            let currentTagIdx = -1;
            let scheduler = null;
            let schedulerWaiting = false;
            const processedJobHrefs = new Set();

            // 日志面板的开始/结束事件只控制前端任务，后端保持运行
            const logger = new Logger(() => {
                this.pause = false;
                logger.add('任务已开始');
                if (!started) return main();
                // 主链正在等待时点，再次开始后会自动继续，不重复启动
                if (schedulerWaiting) return;
                if (pendingRoundRestart) {
                    pendingRoundRestart = false;
                    return startRound();
                }
                loop();
            }, () => {
                this.pause = true;
                logger.add('任务已结束，后台服务保持运行');
            });

            // 开始广播
            const startBroadcast = () => {
                this.__broadcast(this.targets.search);
                // 接收聊天页的消息提醒
                this.broadcast.on(this.bcTypes.STATUS, (from, data) => {
                    if (from === this.targets.chat) {
                        logger.add(data);
                    }
                });
                // 分割线
                this.broadcast.on(this.bcTypes.DIVIDER, () => {
                    logger.divider();
                });
                // 监听打招呼
                greetListener();
                // 监听聊天页
                chatListener();
                // 心跳监听
                heartBeatListener();
            };

            // 执行搜索
            const search = async (kw) => {
                try {
                    const input = await tools.endlessFind(SELECTORS.ZHIPIN.SEARCH.SEARCHINPUT);
                    const btn = await tools.endlessFind(SELECTORS.ZHIPIN.SEARCH.SEARCHBTN);
                    tools.inputText(input, kw);
                    btn.click();
                } catch (e) {
                    logger.add('搜索出错');
                    throw new Error('搜索出错');
                }
            };

            // 获取职位链接
            const getJobHrefs = async () => {
                try {
                    const jobUl = await tools.endlessFind(SELECTORS.ZHIPIN.SEARCH.JOBLIST);
                    const aList = jobUl.querySelectorAll(SELECTORS.ZHIPIN.SEARCH.JOBHREFS);
                    const remaining = OPTIONS.maxJobsPerRun > 0
                        ? Math.max(0, OPTIONS.maxJobsPerRun - count - jobHrefs.length)
                        : Number.POSITIVE_INFINITY;
                    const hrefs = Array.from(aList)
                        .map(a => a.href)
                        .slice(elsLen)
                        .filter(href => !processedJobHrefs.has(href))
                        .slice(0, remaining);
                    return [hrefs, aList];
                } catch (e) {
                    logger.add('获取职位链接出错');
                    throw new Error('获取职位链接出错');
                }
            };

            const resetRoundState = () => {
                jobHrefs = [];
                elsLen = 0;
                page = 0;
                roundQueuedCount = 0;
                clearPendingGreet();
            };

            const activatePreloadCard = async (round) => {
                if (!OPTIONS.preloadActivateCardEvery || round % OPTIONS.preloadActivateCardEvery !== 0) return;
                try {
                    const jobUl = document.querySelector(SELECTORS.ZHIPIN.SEARCH.JOBLIST);
                    if (!jobUl) return;
                    const cards = Array.from(jobUl.querySelectorAll(SELECTORS.ZHIPIN.SEARCH.JOBCARD));
                    if (!cards.length) return;
                    const visibleCards = cards.filter(card => {
                        const rect = card.getBoundingClientRect();
                        return rect.top < window.innerHeight - 120 && rect.bottom > 120;
                    });
                    const targetCard = visibleCards[visibleCards.length - 1] || cards[cards.length - 1];
                    if (!targetCard) return;
                    targetCard.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    await tools.asyncSleep(120);
                    targetCard.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                    targetCard.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                    targetCard.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                    logger.add(`预加载第 ${round} 轮：已轻点左侧岗位卡片`);
                    await tools.asyncSleep(OPTIONS.preloadActivateCardWaitMs);
                } catch (e) {
                    logger.add('预加载时轻点岗位卡片失败，已继续纯滚动');
                }
            };

            // 下一页
            const nextPage = async () => {
                while (true) {
                    let hrefs, els;
                    [hrefs, els] = await getJobHrefs();
                    if (els.length === elsLen) {
                        logger.add('没有更多职位了');
                        return false;
                    }
                    elsLen = els.length;
                    els[elsLen - 1].scrollIntoView();
                    page++;
                    logger.add(`开始浏览第 ${page} 页`);
                    if (hrefs.length) {
                        jobHrefs.push(...hrefs);
                        roundQueuedCount += hrefs.length;
                        logger.add(`本页新增 ${hrefs.length} 个未处理岗位`);
                        return true;
                    }
                    logger.add('本页新增岗位都已处理过，继续向下查找');
                    await tools.asyncSleep(OPTIONS.preloadScrollWaitMs);
                }
            };

            document.nextPage = nextPage

            let pendingGreetTimer = null;
            let pendingGreetTitle = '';
            let pendingGreetDecision = null;

            const clearPendingGreet = () => {
                if (pendingGreetTimer) {
                    clearTimeout(pendingGreetTimer);
                    pendingGreetTimer = null;
                }
                pendingGreetTitle = '';
                pendingGreetDecision = null;
            };

            const armPendingGreet = (title, decision = null) => {
                clearPendingGreet();
                pendingGreetTitle = title;
                pendingGreetDecision = decision;
                pendingGreetTimer = setTimeout(() => {
                    logger.add(`职位 [${pendingGreetTitle}] 打招呼超时，已跳过`);
                    clearPendingGreet();
                    loop();
                }, OPTIONS.greetTimeout);
            };

            const handleRoundExhausted = async () => {
                if (roundTransitioning) return;
                roundTransitioning = true;
                try {
                    if (roundQueuedCount === 0) {
                        emptyRounds += 1;
                        logger.add(`第 ${currentRound} 轮没有拿到新岗位（连续空轮 ${emptyRounds}/${OPTIONS.maxEmptyRounds}）`);
                    } else {
                        emptyRounds = 0;
                        logger.add(`第 ${currentRound} 轮已处理完当前加载岗位，准备进入下一轮`);
                    }
                    if (emptyRounds >= OPTIONS.maxEmptyRounds) {
                        logger.add(`连续 ${OPTIONS.maxEmptyRounds} 轮没有新岗位，自动切换到下一个关键词继续挂机`);
                        emptyRounds = 0;
                        return startRound();
                    }
                    await tools.asyncSleep(OPTIONS.roundRestartDelayMs);
                    if (this.pause) {
                        pendingRoundRestart = true;
                        logger.add('任务已结束，下一轮等待再次开始');
                        return;
                    }
                    await startRound();
                } finally {
                    roundTransitioning = false;
                }
            };

            // 获取职位信息
            const getJobInfo = async (href) => {
                // 打开窗口
                tools.openTabNSetTimestamp(href, this.targets.detail);
                // 接收职位信息
                const info = await this.broadcast.receive(
                    this.targets.detail,
                    this.bcTypes.GET_JOB_INFO,
                    OPTIONS.detailTimeout
                ).catch(() => ({
                    skip: true,
                    skipReason: `获取职位详情超时（>${(OPTIONS.detailTimeout / 1000).toFixed(0)}s）`,
                }));
                return info;
            };

            // 添加到聊天列表
            const addToChatList = async (url) => {
                return new Promise((resolve, reject) => {
                    fetch(url)
                        .then(async resp => {
                            if (!(resp.ok && resp.status === 200)) {
                                const bodyText = await resp.text().catch(() => '');
                                logger.add(`boss直聘网络连接出错: status=${resp.status}`);
                                return reject(new Error(`http_${resp.status}:${bodyText.slice(0, 300)}`));
                            }
                            return resp.json();
                        }).then(resp => {
                            if (resp.code === 0) return resolve(resp);
                            const msg = resp?.zpData?.bizData?.chatRemindDialog?.title || resp?.message || '未知错误';
                            logger.add(`打招呼失败: ${msg}`);
                            reject(new Error(`biz_fail:${msg}`));
                        }).catch(err => {
                            reject(err instanceof Error ? err : new Error(String(err)));
                        });
                });
            };

            // 打招呼监听
            const greetListener = () => {
                this.broadcast.on(this.bcTypes.SAY_HI, async (from, data) => {
                    if (from !== this.targets.chatGreet) return;
                    // 要自我介绍
                    if (data.requestId) {
                        this.broadcast.reply(
                            from,
                            this.bcTypes.SAY_HI,
                            {
                                introduce: pendingGreetDecision?.introduce || this.introduce,
                                resumeIndex: pendingGreetDecision?.resumeIndex ?? OPTIONS.resumeIndex,
                            },
                            data.requestId,
                            data.responseType
                        );
                        return;
                    }
                    // 告知结果
                    clearPendingGreet();
                    if (data.success) {
                        logger.add(`打招呼成功`);
                    }
                    // 出错了
                    else {
                        logger.add(`打招呼失败`);
                        logger.add(`本时点执行失败，继续等待下一时点`);
                    }
                    loop();
                });
            };

            // 聊天页监听
            const chatListener = () => {
                this.broadcast.on(this.bcTypes.RUN, async (from, data) => {
                    if (from !== this.targets.chat) return;
                    if (data) {
                        logger.divider();
                        const hasNext = await nextPage();
                        if (!hasNext) return handleRoundExhausted();
                        loop();
                    } else {
                        logger.add(`消息处理出错，重试中...`);
                        tools.openTabNSetTimestamp(this.whiteList.chat, this.targets.chat);
                    }
                });
            };

            // 心跳监听
            const heartBeatListener = () => {
                this.broadcast.on(this.bcTypes.HEART_BEAT, async (from, data) => {
                    this.broadcast.reply(
                        from,
                        this.bcTypes.HEART_BEAT,
                        { success: true },
                        data.requestId,
                        data.responseType
                    );
                });
            }

            // 循环
            const loop = async () => {
                try {
                    // 如果任务已结束，则停止当前前端执行链
                    if (this.pause) {
                        logger.add('任务当前已结束');
                        return;
                    }
                    if (OPTIONS.maxJobsPerRun > 0 && count >= OPTIONS.maxJobsPerRun) {
                        logger.stop();
                        logger.add(`已完成 ${count} 个真实 JD 的试运行，程序自动结束`);
                        logger.add('确认结果后，可将 frontend.maxJobsPerRun 改为 0 解除上限');
                        return;
                    }
                    logger.divider();
                    // 判断职位链接是否为空
                    if (jobHrefs.length === 0) {
                        // 判断是否需要代聊天
                        if (OPTIONS.onlyGreet) {
                            const hasNext = await nextPage();
                            if (!hasNext) return handleRoundExhausted();
                            return loop();
                        }
                        logger.add('开始处理聊天消息');
                        tools.openTabNSetTimestamp(this.whiteList.chat, this.targets.chat);
                        return;
                    }
                    // 抽取第一个
                    const href = jobHrefs.shift();
                    const diff = (new Date().getTime() - start) / 1000;
                    // 获取详情
                    logger.add(`| 浏览: ${++count} | 剩余: ${jobHrefs.length} | 平均: ${(diff / count).toFixed(0)}s | 耗时: ${convertTime(diff)} |`);
                    logger.add(`正在获取职位详情`);
                    const jobInfo = await getJobInfo(href);
                    if (this.pause) return;
                    if (jobInfo.skip) {
                        logger.add(`职位跳过: ${jobInfo.skipReason}`);
                        return loop();
                    }
                    processedJobHrefs.add(href);
                    // 如果聊过，下一个
                    if (jobInfo.talked) {
                        logger.add(`职位 [${jobInfo.title}] 已经聊过，下一个`);
                        return loop();
                    }
                    // 否则发送消息计算匹配度
                    logger.add(`开始计算职位 [${jobInfo.title}] 的匹配度`);
                    const decision = await api.getJobScore(jobInfo.title, jobInfo.salary, jobInfo.detail);
                    if (this.pause) return;
                    logger.add(`匹配度: ${decision.score} | 简历索引: ${decision.resumeIndex}`);
                    // 如果分数达到阈值，等待当前小时的下一个时点再打招呼
                    if (decision.score >= OPTIONS.thread) {
                        if (!scheduler) {
                            logger.add('调度器未初始化，跳过该岗位');
                            return loop();
                        }
                        schedulerWaiting = true;
                        let scheduledSlot = null;
                        try {
                            scheduledSlot = await scheduler.waitForNextSlot((msg) => logger.add(msg), () => this.pause);
                        } finally {
                            schedulerWaiting = false;
                        }
                        if (scheduledSlot === null) {
                            if (!this.pause) loop();
                            return;
                        }
                        logger.add(`正在给职位 [${jobInfo.title}] 发送打招呼消息`);
                        // 判断是否有提醒返回
                        addToChatList(jobInfo.addUrl).then(() => {
                            if (this.pause) return;
                            armPendingGreet(jobInfo.title, decision);
                            tools.openTabNSetTimestamp(jobInfo.chatUrl, this.targets.chatGreet);
                        }).catch(() => {
                            logger.add('本时点执行失败，继续等待下一时点');
                            clearPendingGreet();
                            loop();
                        });
                    }
                    // 否则下一轮
                    else {
                        loop();
                    }
                } catch (e) {
                    console.log(e);
                    logger.add(`循环时出错: ${e}`);
                    loop();
                }
            };

            const preloadJobs = async () => {
                const targetCount = OPTIONS.maxJobsPerRun > 0
                    ? Math.max(0, OPTIONS.maxJobsPerRun - count)
                    : Number.POSITIVE_INFINITY;
                logger.add(OPTIONS.maxJobsPerRun > 0
                    ? `准备加载最多 ${targetCount} 张候选岗位卡片`
                    : '开始慢速预加载岗位列表');
                let stableRounds = 0;
                let lastCount = 0;
                let lastScrollY = -1;
                const initialJobUl = await tools.endlessFind(SELECTORS.ZHIPIN.SEARCH.JOBLIST).catch(() => null);
                const initialCount = initialJobUl ? initialJobUl.querySelectorAll(SELECTORS.ZHIPIN.SEARCH.JOBHREFS).length : 0;
                if (initialCount >= targetCount) {
                    logger.add(`当前列表已有 ${initialCount} 张岗位卡片，无需继续滚动预加载`);
                    return;
                }
                for (let round = 1; round <= OPTIONS.preloadMaxRounds; round++) {
                    const jobUl = await tools.endlessFind(SELECTORS.ZHIPIN.SEARCH.JOBLIST).catch(() => null);
                    const currentCount = jobUl ? jobUl.querySelectorAll(SELECTORS.ZHIPIN.SEARCH.JOBHREFS).length : 0;
                    window.scrollBy({ top: OPTIONS.preloadScrollPixels, left: 0, behavior: 'smooth' });
                    await tools.asyncSleep(OPTIONS.preloadScrollWaitMs);
                    await activatePreloadCard(round);
                    const afterJobUl = document.querySelector(SELECTORS.ZHIPIN.SEARCH.JOBLIST);
                    const afterCount = afterJobUl ? afterJobUl.querySelectorAll(SELECTORS.ZHIPIN.SEARCH.JOBHREFS).length : currentCount;
                    const afterY = window.scrollY;
                    if (round === 1 || afterCount !== currentCount || round % 10 === 0) {
                        logger.add(`预加载第 ${round} 轮：岗位 ${currentCount} -> ${afterCount}`);
                    }
                    if (afterCount >= targetCount) {
                        logger.add(`已加载不少于 ${targetCount} 张候选岗位卡片，停止预加载`);
                        break;
                    }
                    if (afterCount > lastCount || afterY > lastScrollY) {
                        stableRounds = 0;
                    } else {
                        stableRounds += 1;
                    }
                    lastCount = Math.max(lastCount, afterCount);
                    lastScrollY = Math.max(lastScrollY, afterY);
                    if (stableRounds >= OPTIONS.preloadStableRoundsLimit) {
                        logger.add(`预加载结束：连续 ${stableRounds} 轮无新增岗位`);
                        break;
                    }
                }
                const finalJobUl = document.querySelector(SELECTORS.ZHIPIN.SEARCH.JOBLIST);
                const finalCount = finalJobUl ? finalJobUl.querySelectorAll(SELECTORS.ZHIPIN.SEARCH.JOBHREFS).length : 0;
                logger.add(`预加载完成，当前已加载岗位数：${finalCount}`);
            };

            const pickNextKeyword = () => {
                if (!this.tags || !this.tags.length) {
                    throw new Error('未获取到岗位关键词列表');
                }
                currentTagIdx = (currentTagIdx + 1) % this.tags.length;
                currentKeyword = this.tags[currentTagIdx];
                return currentKeyword;
            };

            const startRound = async () => {
                resetRoundState();
                currentRound += 1;
                const keyword = pickNextKeyword();
                logger.divider();
                logger.add(`开始第 ${currentRound} 轮`);
                logger.add(`本轮搜索关键词：${keyword}`);
                window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
                await tools.asyncSleep(600);
                await search(keyword);
                logger.add(`第 ${currentRound} 轮已完成搜索（关键词：${keyword}），请在 ${(OPTIONS.manualFilterWaitMs / 1000).toFixed(0)} 秒内手动选择地区、薪资等筛选条件`);
                await tools.asyncSleep(OPTIONS.manualFilterWaitMs);
                await preloadJobs();
                logger.add(`第 ${currentRound} 轮开始按当前筛选条件扫描岗位（关键词：${keyword}）`);
                loop();
            };

            // 主函数
            const main = async () => {
                started = true;
                logger.add('--程序启动--');
                // 开始广播
                startBroadcast();
                // 获取统一配置
                const clientConfig = await api.getClientConfig().catch(() => null);
                if (!clientConfig
                    || !clientConfig.frontend
                    || !Array.isArray(clientConfig.tags)
                    || !clientConfig.tags.length
                    || typeof clientConfig.introduce !== 'string'
                    || !clientConfig.introduce) {
                    logger.add('获取统一配置失败，程序停止');
                    return;
                }
                Object.assign(OPTIONS, clientConfig.frontend);
                this.tags = clientConfig.tags;
                this.introduce = clientConfig.introduce;
                scheduler = new HourlyScheduler(clientConfig.schedule);
                logger.add('获取前端配置成功');
                logger.add('获取标签成功: ' + this.tags.join('、'));
                logger.add('获取自我介绍成功');
                if (typeof tagIdx === 'number' && this.tags.length) {
                    currentTagIdx = ((tagIdx % this.tags.length) + this.tags.length) % this.tags.length - 1;
                }
                await startRound();
            };

            // 初始化
            const init = () => {
                // 如果时间戳小于阈值，直接运行
                if (start - tools.getTimestamp(this.targets.search) < OPTIONS.timestampTimeout) {
                    logger.runBtn.click();
                }
            };

            init();
        }

        // 详情页
        __detail() {
            // 注册广播
            const startBroadcast = () => {
                this.__broadcast(this.targets.detail);
            };
            startBroadcast();

            // 获取职位信息
            const getJobInfo = () => {
                const chatBtn = document.querySelector(SELECTORS.ZHIPIN.DETAIL.STARTCHAT);
                const nameBox = document.querySelector(SELECTORS.ZHIPIN.DETAIL.NAMEBOX);
                const title = nameBox.querySelector(SELECTORS.ZHIPIN.DETAIL.JOBNAME).innerText;
                const salary = nameBox.querySelector(SELECTORS.ZHIPIN.DETAIL.SALARY).innerText;
                const detail = document.querySelector(SELECTORS.ZHIPIN.DETAIL.DETAIL).innerText;
                const actionText = chatBtn ? chatBtn.innerText.trim() : '';
                const chatUrl = chatBtn && chatBtn.getAttribute(SELECTORS.ZHIPIN.DETAIL.CHATURL);
                const addUrl = chatBtn && chatBtn.dataset.url;
                let skip = false;
                let skipReason = '';

                if (!chatBtn) {
                    skip = true;
                    skipReason = '未找到立即沟通按钮';
                } else if (actionText.indexOf('立即沟通') === -1) {
                    skip = true;
                    skipReason = `按钮为 [${actionText || '未知'}]，疑似网申岗位`;
                } else if (!chatUrl || !addUrl) {
                    skip = true;
                    skipReason = '缺少聊天链接，疑似异常岗位';
                }

                return {
                    title,
                    salary,
                    detail,
                    actionText,
                    chatUrl,
                    addUrl,
                    skip,
                    skipReason,
                    talked: chatBtn && chatBtn.dataset.isfriend === 'true',
                };
            };
            const jobInfo = getJobInfo();

            // 来自搜索页
            const fromSearchPage = () => {
                // 把职位信息发送给搜索页
                this.broadcast.send(this.targets.search, this.bcTypes.GET_JOB_INFO, jobInfo);
            };

            // 主函数
            const main = () => {
                // 判断来源
                const now = new Date().getTime();
                const isFromSearch = now - tools.getTimestamp(this.targets.detail) < OPTIONS.timestampTimeout && window.name === this.targets.detail;

                if (isFromSearch) {
                    fromSearchPage();
                }
            };
            main();
        }

        // 聊天页
        async __chat() {
            // 注册广播
            const startBroadcast = (target = this.targets.chat) => {
                this.__broadcast(target);
            };

            // 发送消息
            const sendMsg = (text) => {
                return new Promise(async (resolve, reject) => {
                    try {
                        const ipt = await tools.endlessFind(SELECTORS.ZHIPIN.CHAT.CHATINPUT);
                        ipt.innerText = text;
                        await tools.asyncSleep(600);
                        const btn = await tools.endlessFind(SELECTORS.ZHIPIN.CHAT.MSGSEND);
                        btn.click();
                        resolve();
                    } catch (e) {
                        reject();
                    }
                })
            };

            // 打招呼
            const sayHi = async () => {
                startBroadcast(this.targets.chatGreet);

                // 心跳 
                let count = 0;
                const loop = () => {
                    this.broadcast.sendAndReceive(
                        this.targets.search,
                        this.bcTypes.HEART_BEAT,
                        { count: ++count }
                    ).then((res) => {
                        if (res.success) {
                            setTimeout(loop, 1000);
                        } else {
                            throw new Error('心跳失联');
                        }
                    });
                };
                loop();

                try {
                    const greetDecision = await this.broadcast.sendAndReceive(this.targets.search, this.bcTypes.SAY_HI);
                    const introduce = greetDecision.introduce;
                    await sendMsg(introduce);
                    this.broadcast.send(this.targets.search, this.bcTypes.SAY_HI, { success: true }).then(() => {
                        this.broadcast.destroy();
                    });
                } catch (e) {
                    this.broadcast.send(this.targets.search, this.bcTypes.SAY_HI, { success: false }).then(() => {
                        this.broadcast.destroy();
                    });
                }
            };

            // 获取聊天记录信息
            const getChatInfo = async () => {
                const ctn = await tools.endlessFind(SELECTORS.ZHIPIN.CHAT.HISTORYCTN);

                const getMsgs = async () => {
                    const lis = Array.from(ctn.querySelectorAll(SELECTORS.ZHIPIN.CHAT.USEFULMSG));
                    // 提取历史记录
                    const msgs = [];
                    lis.forEach(li => {
                        const role = li.classList.contains('item-friend') ? 'user' : 'assistant';
                        const msgBox = li.querySelector(SELECTORS.ZHIPIN.CHAT.MSGCONTENT);
                        if (!msgBox) return;
                        msgs.push({
                            role,
                            content: msgBox.innerText,
                        });
                    });
                    // 判断是否发过简历：聊天记录出现“点击预览附件简历”即视为已发送
                    let resumeSended = false;
                    ctn.querySelectorAll('.boss-green').forEach(el => {
                        if (el.innerText.indexOf('点击预览附件简历') !== -1) {
                            resumeSended = true;
                        }
                    });
                    // 判断是否存在 Boss 内置的索要附件简历请求卡片
                    let hasResumeRequestCard = false;
                    ctn.querySelectorAll('.boss-green').forEach(el => {
                        if (el.innerText.indexOf('我想要一份您的附件简历') !== -1) {
                            hasResumeRequestCard = true;
                        }
                    });
                    return {
                        msgs,
                        resumeSended,
                        hasResumeRequestCard,
                    };
                };

                const scroll2Top = async () => {
                    if (ctn.scrollTop === 0) return;
                    ctn.scrollTop = 0;
                    await tools.asyncSleep(300);
                    await scroll2Top();
                };

                // 滚动到顶部
                await tools.asyncSleep(300);
                await scroll2Top();
                // 获取聊天记录
                return await getMsgs();
            };

            // 发送简历：只负责发送附件，成功后由调用方单独回复
            const sendResume = async (resumeIndex = OPTIONS.resumeIndex) => {
                const sendBtn = await tools.endlessFind(SELECTORS.ZHIPIN.CHAT.RESUMESEND);
                sendBtn.click();

                // 可能是弹一个小窗
                const smallDialog = await tools.endlessFind(SELECTORS.ZHIPIN.CHAT.RESUMEMODAL).catch(() => null);
                if (smallDialog) {
                    smallDialog.querySelector(SELECTORS.ZHIPIN.CHAT.RESUMEMODALCONFIRM).click();
                    return {
                        mode: 'small_dialog',
                        selectedResumeIndex: resumeIndex,
                    };
                }

                // 弹出大窗让选择
                const resumeCtn = await tools.endlessFind(SELECTORS.ZHIPIN.CHAT.RESUMELIST);
                const confirm = await tools.endlessFind(SELECTORS.ZHIPIN.CHAT.RESUMESENDCONFIRM);
                const resumes = resumeCtn.querySelectorAll(SELECTORS.ZHIPIN.CHAT.RESUMELISTITEM);
                const fallbackIndex = resumes[resumeIndex] ? resumeIndex : (resumes[OPTIONS.resumeIndex] ? OPTIONS.resumeIndex : 0);
                const resume = resumes[fallbackIndex];
                await tools.asyncSleep(300);
                resume.click();
                await tools.asyncSleep(300);
                confirm.click();
                return {
                    mode: 'resume_list',
                    selectedResumeIndex: fallbackIndex,
                };
            };

            // 判断最新 HR 消息是否明确索要简历：否定规则优先
            const isExplicitResumeRequest = (message, hasRequestCard) => {
                // Boss 内置索要附件简历卡片直接视为明确请求
                if (hasRequestCard) return true;
                if (typeof message !== 'string' || !message.trim()) return false;
                // 标准化空格和常见标点
                const text = message
                    .replace(/\s+/g, '')
                    .replace(/[，。！？、,.!?;；:：~～“”‘’"'（）()【】\[\]吗吧呢啊呀哦]/g, '');
                // 否定表达优先
                const negativePatterns = [
                    '不用发简历', '不需要简历', '不需要', '不用简历', '无需简历', '不必发简历', '不用发', '不要简历', '不要发', '别发简历', '别发',
                    '暂不需要', '暂时不用', '先不用', '以后再说',
                    '简历不匹配', '简历不太匹配', '不太匹配', '不匹配',
                    '暂不考虑', '不考虑', '不合适', '不太合适', '不感兴趣', '暂无需求', '不招了', '已招到', '已经招到', '招满了',
                ];
                for (const pattern of negativePatterns) {
                    if (text.indexOf(pattern) !== -1) return false;
                }
                // 明确请求表达
                const requestPatterns = [
                    '发一份简历', '发下简历', '发一下简历', '发个简历', '发简历', '发送简历', '发送一下简历',
                    '发一份您的简历', '发一份你的简历', '发一下您的简历', '发一下你的简历', '发您的简历', '发你的简历',
                    '简历发我', '简历发一下', '简历发过来', '简历发给我', '简历发来看看', '简历发来',
                    '您的简历发我', '你的简历发我', '把您的简历发', '把你的简历发',
                    '简历看一下', '简历看下', '简历看看', '发我简历', '给我简历', '给我一份简历',
                    '来一份简历', '来份简历', '要一份简历', '需要简历', '需要一份简历', '收一份简历', '收下简历',
                    '请发简历', '请提供简历', '麻烦发简历', '麻烦把简历', '把简历发',
                    '简历方便发', '简历麻烦发', '简历请发', '发我一下简历',
                    '想看简历', '想看下简历', '想看一下简历', '想看看简历', '看下简历', '看一下简历', '看看简历',
                    '看下你的简历', '看一下你的简历', '看看你的简历', '想看你的简历',
                    '发附件简历', '附件简历发', '投一下简历', '发我一份简历',
                ];
                for (const pattern of requestPatterns) {
                    if (text.indexOf(pattern) !== -1) return true;
                }
                return false;
            };

            let logger = null;
            // 给搜索页同步状态
            const status = (text) => {
                logger && logger.add(text);
                this.broadcast && this.broadcast.send(
                    this.targets.search,
                    this.bcTypes.STATUS,
                    text
                );
            };
            // 分割线
            const divider = () => {
                logger && logger.divider();
                this.broadcast && this.broadcast.send(this.targets.search, this.bcTypes.DIVIDER);
            };

            // 聊天
            const chat = async () => {
                // 开始广播
                startBroadcast(this.targets.chat);
                // 心跳
                let count = 0;
                const loop = async () => {
                    await this.broadcast.sendAndReceive(
                        this.targets.search,
                        this.bcTypes.HEART_BEAT,
                        { count: ++count }
                    ).then((res) => {
                        if (res.success) {
                            setTimeout(loop, 1000);
                        } else {
                            throw new Error('心跳失联');
                        }
                    });
                };
                loop();

                // 一轮
                let round = 0;
                let lastTop = 0;
                const once = async () => {
                    // 获取联系人列表
                    let empty = false;
                    const ctn = await tools.endlessFind(SELECTORS.ZHIPIN.CHAT.CONTACTLIST).catch(e => {
                        if (document.querySelector(SELECTORS.ZHIPIN.CHAT.CONTACTLISTEMPTY)) {
                            status('当前暂无消息');
                            empty = true;
                        }
                    });
                    if (empty) return;
                    const lis = ctn.querySelectorAll(SELECTORS.ZHIPIN.CHAT.CONTACTLISTITEM);
                    // 遍历新消息
                    for (const ls of lis) {
                        try {
                            // 无新消息
                            if (!ls.querySelector(SELECTORS.ZHIPIN.CHAT.NEWMSGNOTICE)) continue;
                            // 获取联系人信息
                            const name = ls.querySelector(SELECTORS.ZHIPIN.CHAT.USERNAME);
                            const company = name.nextElementSibling.innerText;
                            divider();
                            status(`[${company} - ${name.innerText}] 发来一条新消息`);
                            // 进入聊天界面
                            name.click();
                            // 获取聊天记录信息
                            const chatInfo = await getChatInfo();
                            const lastMsg = chatInfo.msgs.at(-1);
                            // 已发过简历的会话不再执行任何自动处理
                            if (chatInfo.resumeSended) {
                                status('已发过简历，该会话不再自动处理');
                                continue;
                            }
                            // 只有最新 HR 消息明确索要简历，或存在 Boss 索要简历卡片时才发送
                            const hasExplicitTextRequest = lastMsg
                                && lastMsg.role === 'user'
                                && isExplicitResumeRequest(lastMsg.content, false);
                            if (!hasExplicitTextRequest && !chatInfo.hasResumeRequestCard) {
                                status('未检测到明确索要简历，不自动处理');
                                continue;
                            }
                            status(`正在发送简历（简历索引 ${OPTIONS.resumeIndex}）`);
                            await sendResume(OPTIONS.resumeIndex);
                            await sendMsg('发给您了哈');
                            status('发送成功');
                        } catch (e) {
                            status('回复某条消息出错');
                        }
                    }
                    // 向下滚动
                    ctn.scrollTop = 1014 * ++round;
                    await tools.asyncSleep(300);
                    if (ctn.scrollTop !== lastTop) {
                        lastTop = ctn.scrollTop;
                        await once();
                    }
                };
                // 完成一轮
                await once();
            };

            // 主函数
            const main = async () => {
                // 判断来源
                const now = new Date().getTime();
                const isGreet = now - tools.getTimestamp(this.targets.chatGreet) < OPTIONS.timestampTimeout && window.name === this.targets.chatGreet;
                const isChat = now - tools.getTimestamp(this.targets.chat) < OPTIONS.timestampTimeout && window.name === this.targets.chat;

                if (isGreet) {
                    sayHi();
                }
                else if (isChat) {
                    // 日志
                    logger = new Logger();
                    logger.runBtn.remove();
                    logger.clearBtn.remove();
                    // 等待加载
                    await tools.asyncSleep(3000);
                    chat()
                        .then(async () => {
                            status('消息处理完毕');
                            await this.broadcast.send(this.targets.search, this.bcTypes.RUN, true);
                        })
                        .catch(async () => {
                            status('聊天程序运行出错');
                            await this.broadcast.send(this.targets.search, this.bcTypes.RUN, false);
                        }).finally(() => {
                            this.broadcast.destroy();
                        });
                }
            };
            main();
        }

        // 运行
        run(tagIdx = 0) {
            const path = location.pathname;
            // 在搜索页
            if (path.startsWith(SEARCHPATH.zhipin)) {
                this.__search(tagIdx);
            }
            // 在详情页
            else if (path.startsWith(this.whiteList.deatil)) {
                this.__detail();
            }
            // 在聊天页
            else if (path.startsWith(this.whiteList.chat)) {
                this.__chat();
            }
            // 否则跳转搜索页
            else {
                new Logger(() => {
                    tools.openTabNSetTimestamp(SEARCHPATH.zhipin, this.targets.search, true);
                });
            }
        }
    }

    const goodjobs = new Zhipin().run();
})();
