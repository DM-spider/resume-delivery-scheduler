// ==UserScript==
// @name         JobApplyScheduler
// @namespace    job-apply-scheduler
// @version      2026-09-01
// @description  求职投递调度器
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
        onlyGreet: false, // 是否只打招呼，默认为false，即打招呼和代聊天
        manualFilterWaitMs: 10000, // 每轮搜索后留给用户手动筛选的时间
        detailTimeout: 10000, // 获取职位详情超时时间
        greetTimeout: 12000, // 打招呼页回执超时时间
        resumeScanTimeout: 120000, // 简历请求扫描页回执超时时间
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
            detail: '/job_detail',
            chat: '/web/geek/chat'
        },
    };

    const RUNTIME_KEYS = {
        AUTOMATION_STATE_KEY: '__job_apply_scheduler_automation_state',
        SHARED_LOG_KEY: '__job_apply_scheduler_shared_logs',
        CLIENT_CONFIG_KEY: '__job_apply_scheduler_client_config',
        RUN_ID_KEY: '__job_apply_scheduler_run_id',
        WORKER_TASK_PREFIX: '__job_apply_scheduler_worker_task:',
        WORKER_CLAIMED_PREFIX: '__job_apply_scheduler_worker_claimed:',
        SHARED_LOG_LIMIT: 200,
    };

    const AutomationRuntime = {
        start() {
            const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
            localStorage.setItem(RUNTIME_KEYS.RUN_ID_KEY, runId);
            localStorage.setItem(RUNTIME_KEYS.AUTOMATION_STATE_KEY, 'running');
            return runId;
        },
        stop() {
            localStorage.setItem(RUNTIME_KEYS.AUTOMATION_STATE_KEY, 'stopped');
        },
        isRunning() {
            return localStorage.getItem(RUNTIME_KEYS.AUTOMATION_STATE_KEY) === 'running';
        },
        getRunId() {
            return localStorage.getItem(RUNTIME_KEYS.RUN_ID_KEY) || '';
        },
        setClientConfig(config) {
            localStorage.setItem(RUNTIME_KEYS.CLIENT_CONFIG_KEY, JSON.stringify(config));
        },
        getClientConfig() {
            try {
                const raw = localStorage.getItem(RUNTIME_KEYS.CLIENT_CONFIG_KEY);
                return raw ? JSON.parse(raw) : null;
            } catch (e) {
                return null;
            }
        },
        createWorkerTask(role) {
            const task = {
                id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
                role,
                runId: this.getRunId(),
            };
            localStorage.setItem(
                `${RUNTIME_KEYS.WORKER_TASK_PREFIX}${role}`,
                JSON.stringify(task)
            );
            return task;
        },
        getWorkerTask(role) {
            try {
                const raw = localStorage.getItem(`${RUNTIME_KEYS.WORKER_TASK_PREFIX}${role}`);
                return raw ? JSON.parse(raw) : null;
            } catch (e) {
                return null;
            }
        },
        isWorkerTaskCurrent(task) {
            const current = task?.role ? this.getWorkerTask(task.role) : null;
            return Boolean(task?.runId)
                && task.runId === this.getRunId()
                && current?.id === task.id;
        },
        cancelWorkerTask(task) {
            if (!task?.role || !this.isWorkerTaskCurrent(task)) return;
            localStorage.removeItem(`${RUNTIME_KEYS.WORKER_TASK_PREFIX}${task.role}`);
        },
        isWorkerTaskClaimed(task) {
            if (!task?.id) return true;
            return sessionStorage.getItem(
                `${RUNTIME_KEYS.WORKER_CLAIMED_PREFIX}${task.role}`
            ) === task.id;
        },
        claimWorkerTask(task) {
            if (!task?.id || this.isWorkerTaskClaimed(task)) return false;
            sessionStorage.setItem(
                `${RUNTIME_KEYS.WORKER_CLAIMED_PREFIX}${task.role}`,
                task.id
            );
            return true;
        },
    };

    const SharedLogStore = {
        read() {
            try {
                const raw = localStorage.getItem(RUNTIME_KEYS.SHARED_LOG_KEY);
                const entries = raw ? JSON.parse(raw) : [];
                return Array.isArray(entries) ? entries : [];
            } catch (e) {
                return [];
            }
        },
        append(message) {
            const entry = {
                id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
                message: String(message),
            };
            const entries = this.read();
            entries.push(entry);
            localStorage.setItem(
                RUNTIME_KEYS.SHARED_LOG_KEY,
                JSON.stringify(entries.slice(-RUNTIME_KEYS.SHARED_LOG_LIMIT))
            );
            return entry;
        },
        clear() {
            localStorage.removeItem(RUNTIME_KEYS.SHARED_LOG_KEY);
        },
    };

    function installWorkerReadOnlyGuard(label) {
        const badge = document.createElement('div');
        badge.textContent = `${label} | 自动执行中 | 只读`;
        badge.style.cssText = `
            position: fixed;
            top: 16px;
            right: 16px;
            z-index: 2147483647;
            padding: 7px 12px;
            border-radius: 6px;
            background: rgba(15, 23, 42, 0.9);
            color: #fff;
            font-size: 13px;
            pointer-events: none;
        `;
        (document.body || document.documentElement).appendChild(badge);
        const blockTrustedInteraction = (event) => {
            if (!event.isTrusted) return;
            event.preventDefault();
            event.stopImmediatePropagation();
        };
        ['pointerdown', 'click', 'dblclick', 'contextmenu', 'beforeinput', 'keydown', 'submit', 'wheel', 'touchmove', 'dragstart']
            .forEach((eventName) => document.addEventListener(eventName, blockTrustedInteraction, true));
        return badge;
    }

    function assertWorkerRunning(isStopped) {
        if (isStopped() || !AutomationRuntime.isRunning()) {
            throw new Error('automation_stopped');
        }
    }

    const BackgroundTimer = {
        worker: null,
        disabled: false,
        sequence: 0,
        pending: new Map(),
        ensureWorker() {
            if (this.worker) return this.worker;
            const workerCode = `self.addEventListener('message', function(e) {
                setTimeout(function() { self.postMessage(e.data.id); }, e.data.delay);
            });`;
            const workerUrl = URL.createObjectURL(new Blob([workerCode], { type: 'application/javascript' }));
            this.worker = new Worker(workerUrl);
            URL.revokeObjectURL(workerUrl);
            this.worker.onmessage = (event) => {
                const pending = this.pending.get(event.data);
                if (!pending) return;
                this.pending.delete(event.data);
                pending.resolve();
            };
            this.worker.onerror = () => {
                const pendingEntries = Array.from(this.pending.values());
                this.pending.clear();
                this.worker?.terminate();
                this.worker = null;
                this.disabled = true;
                pendingEntries.forEach((pending) => {
                    setTimeout(pending.resolve, Math.max(0, pending.targetMs - Date.now()));
                });
            };
            return this.worker;
        },
        sleep(ms) {
            const delay = Math.max(0, Number(ms) || 0);
            if (this.disabled) return new Promise((resolve) => setTimeout(resolve, delay));
            return new Promise((resolve) => {
                let id = 0;
                try {
                    const worker = this.ensureWorker();
                    id = ++this.sequence;
                    this.pending.set(id, { resolve, targetMs: Date.now() + delay });
                    worker.postMessage({ id, delay });
                } catch (e) {
                    if (id) this.pending.delete(id);
                    setTimeout(resolve, delay);
                }
            });
        },
    };

    // 工具
    const tools = {
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
            return BackgroundTimer.sleep(ms);
        },
        openWorkerTabPrepared(href, role, onCreated) {
            const task = AutomationRuntime.createWorkerTask(role);
            onCreated(task);
            task.opened = Boolean(window.open(href, role));
            return task;
        },
        openControllerPage(href, role) {
            window.name = role;
            window.location.assign(href);
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

    class WebBroadcastError extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
            this.name = 'WebBroadcastError';
        }
    }

    class WebBroadcast {
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
            this.storageHandler = (e) => {
                if (e.key === this.storageKey && e.newValue) {
                    const message = JSON.parse(e.newValue);
                    this.handleMessage({ data: message });
                }
            };
            window.addEventListener('storage', this.storageHandler);
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
                        setTimeout(() => {
                            this.send(to, type, data, attempt + 1).then(resolve).catch(reject);
                        }, this.retryInterval);
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
                const pending = { resolve, reject, timer: null };
                const timer = setTimeout(() => {
                    reject(new WebBroadcastError('TIMEOUT', `接收超时: ${type}`));
                    if (this.pendingReceives[key] === pending) delete this.pendingReceives[key];
                }, timeout);

                pending.timer = timer;
                this.pendingReceives[key] = pending;
            });
        }

        cancelReceive(from, type) {
            const key = `${from}-${type}`;
            const pending = this.pendingReceives[key];
            if (!pending) return;
            clearTimeout(pending.timer);
            delete this.pendingReceives[key];
            pending.reject(new WebBroadcastError('CANCELLED', `接收已取消: ${type}`));
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

        destroy() {
            if (this.channel) {
                this.channel.close();
            }
            if (this.storageHandler) window.removeEventListener('storage', this.storageHandler);
            this.pendingReceives = {};
        }
    }

    // api请求
    class Api {
        /**
         * 封装请求
         * @param {string} path 请求路径
         * @param {string} method 请求方法
         * @param {any} data 请求数据
         * @returns {Promise<any>} 请求结果
         */
        __http(path, method = 'GET', data = null) {
            return new Promise((resolve, reject) => {
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
        constructor(startFn, stopFn, options = {}) {
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
                width: 360px;
                background-color: rgba(0, 0, 0, 0.5);
                color: #fff;
                z-index: 9999;
                font-size: 14px;
                border-radius: 10px;
            `;
            btnBox.style.cssText = `
                width: 360px;
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
                width: 360px;
                height: 32px;
                padding: 2px 12px 8px;
                overflow-y: auto;
                display: flex;
                flex-direction: column;
                gap: 4px;
            `;
            clearBtn.innerText = "清空";
            runBtn.innerText = "开始";
            foldBtn.innerText = "展开";
            document.body.appendChild(ctn);
            ctn.appendChild(btnBox);
            btnBox.appendChild(clearBtn);
            btnBox.appendChild(runBtn);
            btnBox.appendChild(foldBtn);
            ctn.appendChild(msgList);
            this.list = msgList;
            this.runBtn = runBtn;
            this.clearBtn = clearBtn;
            this.__startFn = startFn || (() => void 0);
            this.__stopFn = stopFn || (() => void 0);
            this.__running = false;
            this.__persist = options.persist !== false;
            this.__loadShared = options.loadShared !== false;
            this.__seenSharedLogIds = new Set();
            this.__storageHandler = (event) => {
                if (event.key !== RUNTIME_KEYS.SHARED_LOG_KEY) return;
                if (event.newValue === null) {
                    this.clear(false);
                    return;
                }
                this.syncSharedLogs();
            };
            if (this.__loadShared) {
                window.addEventListener('storage', this.__storageHandler);
                this.syncSharedLogs();
            }
            clearBtn.addEventListener('click', () => this.clear(true));
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
                    msgList.style.height = "560px";
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

        render(message) {
            const item = document.createElement('div');
            item.textContent = message;
            this.list.appendChild(item);
            this.list.scrollTop = this.list.scrollHeight;
        }

        add(message, persist = this.__persist) {
            if (!persist) {
                this.render(message);
                return null;
            }
            const entry = SharedLogStore.append(message);
            this.__seenSharedLogIds.add(entry.id);
            this.render(entry.message);
            return entry;
        }

        syncSharedLogs() {
            SharedLogStore.read().forEach((entry) => {
                if (!entry?.id || this.__seenSharedLogIds.has(entry.id)) return;
                this.__seenSharedLogIds.add(entry.id);
                this.render(entry.message);
            });
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

        clear(clearShared = false) {
            while (this.list.firstChild) {
                this.list.removeChild(this.list.firstChild);
            }
            this.__seenSharedLogIds.clear();
            if (clearShared) SharedLogStore.clear();
        }

    }

    // 小时调度器：计划只保存在当前脚本内存中，页面刷新即重置
    class HourlyScheduler {
        constructor(schedule) {
            this.schedule = schedule || {};
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

        buildStrategyOffsets(strategyId, count, durationMs = 60 * 60 * 1000) {
            if (count <= 0) return [];
            const usableDurationMs = Math.max(count, durationMs);
            if (strategyId === 'balanced') {
                return this.buildStratifiedOffsets(count, 0, usableDurationMs);
            }
            if (strategyId === 'front_loaded' || strategyId === 'back_loaded') {
                const exponent = 1.65;
                const offsets = [];
                for (let i = 0; i < count; i++) {
                    const position = (i + Math.random()) / count;
                    const ratio = strategyId === 'front_loaded'
                        ? Math.pow(position, exponent)
                        : 1 - Math.pow(1 - position, exponent);
                    offsets.push(ratio * usableDurationMs);
                }
                return offsets;
            }
            if (strategyId === 'two_waves') {
                const firstCount = Math.ceil(count / 2);
                const secondCount = count - firstCount;
                return [
                    ...this.buildStratifiedOffsets(firstCount, usableDurationMs * 0.03, usableDurationMs * 0.34),
                    ...this.buildStratifiedOffsets(secondCount, usableDurationMs * 0.57, usableDurationMs * 0.4),
                ];
            }

            // 混合节奏：同一小组内间隔 10-45 秒，小组之间自然形成数分钟间隔
            const shortGaps = [10, 20, 30, 45].map((seconds) => seconds * 1000);
            const clusterCount = Math.ceil(count / 2);
            const marginMs = Math.min(2 * 60 * 1000, usableDurationMs * 0.04);
            const segmentMs = Math.max(1, (usableDurationMs - 2 * marginMs) / clusterCount);
            const offsets = [];
            for (let cluster = 0; cluster < clusterCount && offsets.length < count; cluster++) {
                const baseMs = marginMs + cluster * segmentMs + Math.random() * Math.min(segmentMs * 0.35, 90 * 1000);
                offsets.push(baseMs);
                if (offsets.length < count) {
                    const shortGap = shortGaps[Math.floor(Math.random() * shortGaps.length)];
                    offsets.push(Math.min(baseMs + shortGap, marginMs + (cluster + 1) * segmentMs - 1));
                }
            }
            return offsets;
        }

        // 按本轮候选岗位数，在当前小时剩余时间内生成同等数量的逐 JD 轮询时点
        planRound(count, log, now = new Date()) {
            const strategies = this.getStrategies();
            this.currentStrategy = strategies[Math.floor(Math.random() * strategies.length)];
            const startMs = Math.max(Date.now() + 1000, now.getTime());
            const hourEndMs = this.nextHourStart(now.getTime());
            const durationMs = Math.max(1000, hourEndMs - startMs);
            this.slots = this.buildStrategyOffsets(this.currentStrategy.id, count, durationMs)
                .map((offset) => startMs + Math.min(offset, durationMs - 1))
                .sort((a, b) => a - b);
            this.cursor = 0;
            this.nextTestSlotMs = 0;
            if (log) log(`本轮策略 [${this.currentStrategy.name}]，计划 ${this.slots.length} 次岗位轮询`);
            return this.slots;
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

        // 首轮立即开始；以后每轮结束后等待下一个整点，不补跑错过的小时
        async waitForNextRound(hasCompletedRound, log, isPaused) {
            let waitForHourBoundary = Boolean(hasCompletedRound);
            while (!isPaused()) {
                const now = new Date();
                const testMode = Number(this.schedule.testIntervalSeconds) > 0;
                if (!testMode && !this.isWorkTime(now)) {
                    const nextMs = this.nextWorkStart(now.getTime());
                    const next = new Date(nextMs);
                    log(`当前不在工作时间，等待下一个工作日 ${next.getMonth() + 1}月${next.getDate()}日 ${this.formatTime(nextMs).slice(0, 5)}`);
                    if (!await this.sleepUntil(nextMs, isPaused)) return null;
                    waitForHourBoundary = false;
                    continue;
                }
                if (!waitForHourBoundary) return now;
                const nextMs = this.nextHourStart(now.getTime());
                log(`本小时流程已完成，等待 ${this.formatTime(nextMs).slice(0, 5)} 开始下一轮`);
                if (!await this.sleepUntil(nextMs, isPaused)) return null;
                waitForHourBoundary = false;
            }
            return null;
        }

        // 等待本轮下一个时点；时点因上一份处理过久而过期时直接作废，不追赶补跑。
        async waitForRoundSlot(log, isPaused) {
            if (isPaused()) return null;
            const testIntervalSeconds = Number(this.schedule.testIntervalSeconds) || 0;
            if (testIntervalSeconds > 0) {
                const intervalMs = Math.max(1000, testIntervalSeconds * 1000);
                const nowMs = Date.now();
                if (!this.nextTestSlotMs || this.nextTestSlotMs <= nowMs) {
                    this.nextTestSlotMs = nowMs + intervalMs;
                }
                const slotMs = this.nextTestSlotMs;
                log(`测试模式：下一次岗位轮询时间 ${this.formatTime(slotMs)}`);
                if (!await this.sleepUntil(slotMs, isPaused)) return null;
                this.nextTestSlotMs = slotMs + intervalMs;
                this.cursor++;
                log(`测试模式：执行本轮第 ${this.cursor}/${this.slots.length} 次岗位轮询，间隔 ${testIntervalSeconds} 秒`);
                return { slotMs, expired: false };
            }
            if (this.cursor >= this.slots.length) return null;
            const slotMs = this.slots[this.cursor];
            this.cursor++;
            if (slotMs <= Date.now()) {
                log(`本轮第 ${this.cursor}/${this.slots.length} 个时点已过期，本时点不读取岗位`);
                return { slotMs, expired: true };
            }
            log(`下一次计划时间 ${this.formatTime(slotMs)}`);
            if (!await this.sleepUntil(slotMs, isPaused)) return null;
            log(`执行本轮第 ${this.cursor}/${this.slots.length} 次岗位轮询`);
            return { slotMs, expired: false };
        }
    }

    // boss 直聘
    class Zhipin {
        constructor() {
            // 窗口标签
            this.targets = {
                search: "__zhipin_search_controller",
                detail: "__zhipin_detail_worker",
                chat: "__zhipin_resume_worker",
                chatGreet: "__zhipin_greet_worker",
            };
            // 广播类型
            this.bcTypes = {
                // 全局
                STATUS: "status",
                RUN: 'run',
                DIVIDER: 'divider',
                STOP: 'stop',
                // 聊天页和职位详情页
                GET_JOB_INFO: 'get-job-info',
                SAY_HI: 'say-hi',
            };
            // 白名单
            this.whiteList = WHITELIST.zhipin;
            // 记录状态
            this.pause = false;
            this.tags = [];
        }

        // 注册广播
        __broadcast(target) {
            this.broadcast = new WebBroadcast('__zhipin_broadcast', target);
        }

        __createWorkerContext(role, label) {
            const task = AutomationRuntime.getWorkerTask(role);
            const badge = installWorkerReadOnlyGuard(label);
            if (!task || !AutomationRuntime.isWorkerTaskCurrent(task) || !AutomationRuntime.claimWorkerTask(task)) {
                badge.textContent = `${label} | 任务已失效或完成 | 只读`;
                return null;
            }
            this.__broadcast(role);
            let stopped = !AutomationRuntime.isRunning();
            this.broadcast.on(this.bcTypes.STOP, () => {
                stopped = true;
                badge.textContent = `${label} | 已停止 | 只读`;
            });
            return {
                task,
                isStopped: () => stopped || !AutomationRuntime.isRunning() || !AutomationRuntime.isWorkerTaskCurrent(task),
                complete: (state = '任务已完成') => {
                    badge.textContent = `${label} | ${state} | 只读`;
                },
            };
        }

        // 搜索页
        async __search(tagIdx) {
            const api = new Api();
            let initialized = false;
            let broadcastStarted = false;
            let controllerPromise = null;
            let currentRound = 0;
            let currentTagIdx = -1;
            let scheduler = null;
            let hasCompletedRound = false;
            let queuedStartRunId = '';
            const processedJobKeys = new Set();
            let pendingGreetTaskId = '';
            let pendingGreetResolve = null;
            let pendingGreetTimer = null;
            let pendingResumeTaskId = '';
            let pendingResumeResolve = null;
            let pendingResumeTimer = null;

            const settlePendingGreet = (result) => {
                if (pendingGreetTimer) clearTimeout(pendingGreetTimer);
                const resolve = pendingGreetResolve;
                pendingGreetTaskId = '';
                pendingGreetResolve = null;
                pendingGreetTimer = null;
                if (resolve) resolve(result);
            };

            const settlePendingResume = (result) => {
                if (pendingResumeTimer) clearTimeout(pendingResumeTimer);
                const resolve = pendingResumeResolve;
                pendingResumeTaskId = '';
                pendingResumeResolve = null;
                pendingResumeTimer = null;
                if (resolve) resolve(result);
            };

            // 日志面板的开始/结束事件只控制前端任务，后端保持运行
            const logger = new Logger(() => {
                window.name = this.targets.search;
                const runId = AutomationRuntime.start();
                hasCompletedRound = false;
                logger.add('任务已开始');
                if (controllerPromise) {
                    queuedStartRunId = runId;
                    this.pause = true;
                    logger.add('上一任务正在结束，完成后自动开始新任务');
                    return;
                }
                this.pause = false;
                startController(runId);
            }, () => {
                queuedStartRunId = '';
                AutomationRuntime.stop();
                this.pause = true;
                settlePendingGreet({ success: false, stopped: true });
                settlePendingResume({ success: false, stopped: true });
                logger.add('任务已结束，后台服务保持运行');
                if (this.broadcast) {
                    this.broadcast.send('all', this.bcTypes.STOP, { reason: 'search_stopped' });
                }
            });

            const startBroadcast = () => {
                if (broadcastStarted) return;
                broadcastStarted = true;
                this.__broadcast(this.targets.search);
                this.broadcast.on(this.bcTypes.STATUS, (from, data) => {
                    if (from === this.targets.chat) logger.add(data);
                });
                this.broadcast.on(this.bcTypes.DIVIDER, () => logger.divider());
                this.broadcast.on(this.bcTypes.SAY_HI, (from, data) => {
                    if (from !== this.targets.chatGreet || !data || data.taskId !== pendingGreetTaskId) return;
                    settlePendingGreet(data);
                });
                this.broadcast.on(this.bcTypes.RUN, (from, data) => {
                    if (from !== this.targets.chat) return;
                    const result = typeof data === 'object' ? data : { success: Boolean(data) };
                    if (result.taskId && result.taskId !== pendingResumeTaskId) return;
                    settlePendingResume(result);
                });
            };

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

            const sleepUnlessPaused = async (durationMs) => {
                const deadline = Date.now() + Math.max(0, durationMs);
                while (!this.pause && Date.now() < deadline) {
                    await tools.asyncSleep(Math.min(200, deadline - Date.now()));
                }
                return !this.pause;
            };

            const activatePreloadCard = async (round) => {
                if (this.pause || !OPTIONS.preloadActivateCardEvery || round % OPTIONS.preloadActivateCardEvery !== 0) return;
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
                    if (!await sleepUnlessPaused(120)) return;
                    targetCard.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                    targetCard.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                    targetCard.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                    logger.add(`预加载第 ${round} 轮：已轻点左侧岗位卡片`);
                    await sleepUnlessPaused(OPTIONS.preloadActivateCardWaitMs);
                } catch (e) {
                    logger.add('预加载时轻点岗位卡片失败，已继续纯滚动');
                }
            };

            const getJobInfo = async (href) => {
                const deadline = Date.now() + OPTIONS.detailTimeout;
                let firstResponse;
                const task = tools.openWorkerTabPrepared(href, this.targets.detail, () => {
                    firstResponse = this.broadcast.receive(
                        this.targets.detail,
                        this.bcTypes.GET_JOB_INFO,
                        OPTIONS.detailTimeout
                    ).catch(() => null);
                });
                if (!task.opened) {
                    this.broadcast.cancelReceive(this.targets.detail, this.bcTypes.GET_JOB_INFO);
                    AutomationRuntime.cancelWorkerTask(task);
                    return { skip: true, skipReason: '职位详情工作页被浏览器拦截' };
                }
                let responsePromise = firstResponse;
                while (Date.now() < deadline) {
                    const info = await responsePromise;
                    if (!info) break;
                    if (info.taskId === task.id) return info;
                    responsePromise = this.broadcast.receive(
                        this.targets.detail,
                        this.bcTypes.GET_JOB_INFO,
                        Math.max(1, deadline - Date.now())
                    ).catch(() => null);
                }
                return {
                    skip: true,
                    skipReason: `获取职位详情超时（>${(OPTIONS.detailTimeout / 1000).toFixed(0)}s）`,
                };
            };

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

            const waitForGreetWorker = (href) => new Promise((resolve) => {
                const task = tools.openWorkerTabPrepared(href, this.targets.chatGreet, (createdTask) => {
                    pendingGreetTaskId = createdTask.id;
                    pendingGreetResolve = resolve;
                    pendingGreetTimer = setTimeout(() => {
                        AutomationRuntime.cancelWorkerTask(createdTask);
                        settlePendingGreet({ success: false, error: 'greet_timeout' });
                    }, OPTIONS.greetTimeout);
                });
                if (!task.opened) {
                    AutomationRuntime.cancelWorkerTask(task);
                    settlePendingGreet({ success: false, error: 'greet_window_blocked' });
                }
            });

            const sendGreeting = async (job) => {
                try {
                    await addToChatList(job.info.addUrl);
                    if (this.pause) return false;
                    const result = await waitForGreetWorker(job.info.chatUrl);
                    if (result.success) logger.add('打招呼成功');
                    else logger.add(`打招呼失败${result.error ? `: ${result.error}` : ''}`);
                    return Boolean(result.success);
                } catch (e) {
                    logger.add(`打招呼失败: ${e?.message || String(e)}`);
                    return false;
                }
            };

            const getJobKey = (href) => {
                try {
                    const url = new URL(href, window.location.origin);
                    return url.pathname.replace(/\/$/, '');
                } catch (e) {
                    return href;
                }
            };

            const getLoadedUnprocessedJobs = (limit = Number.POSITIVE_INFINITY) => {
                const jobUl = document.querySelector(SELECTORS.ZHIPIN.SEARCH.JOBLIST);
                if (!jobUl) return [];
                const roundKeys = new Set();
                return Array.from(jobUl.querySelectorAll(SELECTORS.ZHIPIN.SEARCH.JOBHREFS))
                    .map((anchor) => ({ href: anchor.href, key: getJobKey(anchor.href) }))
                    .filter((job) => {
                        if (!job.href || !job.key || processedJobKeys.has(job.key) || roundKeys.has(job.key)) return false;
                        roundKeys.add(job.key);
                        return true;
                    })
                    .slice(0, limit);
            };

            const preloadJobs = async () => {
                if (this.pause) return false;
                const targetCount = Math.max(1, Number(scheduler.schedule.jobsPerRound) || 50);
                logger.add(`准备加载最多 ${targetCount} 个未处理岗位`);
                let stableRounds = 0;
                let lastCount = 0;
                let lastScrollY = -1;
                const initialCount = getLoadedUnprocessedJobs().length;
                if (initialCount >= targetCount) {
                    logger.add(`当前列表已有 ${initialCount} 个未处理岗位，无需继续预加载`);
                    return true;
                }
                for (let round = 1; round <= OPTIONS.preloadMaxRounds; round++) {
                    if (this.pause) {
                        logger.add('预加载已由结束按钮中止');
                        return false;
                    }
                    const currentCount = getLoadedUnprocessedJobs().length;
                    window.scrollBy({ top: OPTIONS.preloadScrollPixels, left: 0, behavior: 'smooth' });
                    if (!await sleepUnlessPaused(OPTIONS.preloadScrollWaitMs)) {
                        logger.add('预加载已由结束按钮中止');
                        return false;
                    }
                    await activatePreloadCard(round);
                    if (this.pause) {
                        logger.add('预加载已由结束按钮中止');
                        return false;
                    }
                    const afterCount = getLoadedUnprocessedJobs().length;
                    const afterY = window.scrollY;
                    if (round === 1 || afterCount !== currentCount || round % 10 === 0) {
                        logger.add(`预加载第 ${round} 轮：未处理岗位 ${currentCount} -> ${afterCount}`);
                    }
                    if (afterCount >= targetCount) {
                        logger.add(`已加载不少于 ${targetCount} 个未处理岗位，停止预加载`);
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
                const finalCount = getLoadedUnprocessedJobs().length;
                logger.add(`预加载完成，当前未处理岗位数：${finalCount}`);
                return true;
            };

            const processRoundJobs = async () => {
                const jobsPerRound = Math.max(1, Number(scheduler.schedule.jobsPerRound) || 50);
                const jobs = getLoadedUnprocessedJobs(jobsPerRound);
                const testMode = Number(scheduler.schedule.testIntervalSeconds) > 0;
                let readCount = 0;
                let qualifiedCount = 0;
                let greetedCount = 0;
                let expiredCount = 0;
                scheduler.planRound(jobs.length, (msg) => logger.add(msg));
                logger.add(`本轮准备逐份处理 ${jobs.length}/${jobsPerRound} 个未处理 JD`);
                for (let index = 0; index < jobs.length; index++) {
                    if (this.pause) return false;
                    if (!testMode && !scheduler.isWorkTime(new Date())) {
                        logger.add(`已离开工作时间，本轮剩余 ${jobs.length - index} 个岗位不再处理`);
                        break;
                    }
                    const scheduledSlot = await scheduler.waitForRoundSlot(
                        (msg) => logger.add(msg),
                        () => this.pause
                    );
                    if (scheduledSlot === null) return false;
                    if (scheduledSlot.expired) {
                        expiredCount++;
                        continue;
                    }
                    if (!testMode && !scheduler.isWorkTime(new Date())) {
                        logger.add(`已离开工作时间，本轮剩余 ${jobs.length - index} 个岗位不再处理`);
                        break;
                    }
                    const job = jobs[index];
                    logger.divider();
                    logger.add(`开始本轮第 ${index + 1}/${jobs.length} 个岗位轮询`);
                    processedJobKeys.add(job.key);
                    readCount++;
                    try {
                        logger.add('正在读取职位详情');
                        const jobInfo = await getJobInfo(job.href);
                        if (this.pause) return false;
                        if (jobInfo.skip) {
                            logger.add(`职位跳过: ${jobInfo.skipReason}`);
                            continue;
                        }
                        if (jobInfo.talked) {
                            logger.add(`职位 [${jobInfo.title}] 已经聊过，跳过`);
                            continue;
                        }
                        logger.add(`开始计算职位 [${jobInfo.title}] 的匹配度`);
                        const decision = await api.getJobScore(jobInfo.title, jobInfo.salary, jobInfo.detail);
                        if (this.pause) return false;
                        logger.add(`匹配度: ${decision.score}`);
                        if (decision.score < OPTIONS.thread) {
                            logger.add(`未达到投递阈值 ${OPTIONS.thread}，等待下一个岗位轮询`);
                            continue;
                        }
                        qualifiedCount++;
                        if (!testMode && !scheduler.isWorkTime(new Date())) {
                            logger.add('评分合格，但已离开工作时间，本岗位不再投递');
                            break;
                        }
                        logger.add(`评分合格，立即给职位 [${jobInfo.title}] 发送打招呼消息`);
                        if (await sendGreeting({ info: jobInfo })) greetedCount++;
                        if (this.pause) return false;
                    } catch (e) {
                        logger.add(`当前 JD 处理失败，已跳过: ${e?.message || String(e)}`);
                    } finally {
                        if (!this.pause) logger.add('本次岗位轮询结束，等待下一个时点');
                    }
                }
                logger.add(`本轮岗位处理完成：读取 ${readCount} 个，合格 ${qualifiedCount} 个，打招呼成功 ${greetedCount} 个，过期时点 ${expiredCount} 个`);
                return !this.pause;
            };

            const processResumeRequests = async () => {
                if (this.pause) return false;
                if (OPTIONS.onlyGreet) {
                    logger.add('当前配置仅打招呼，本轮跳过简历请求扫描');
                    return true;
                }
                logger.add('本轮投递结束，开始扫描简历请求');
                const result = await new Promise((resolve) => {
                    const task = tools.openWorkerTabPrepared(this.whiteList.chat, this.targets.chat, (createdTask) => {
                        pendingResumeTaskId = createdTask.id;
                        pendingResumeResolve = resolve;
                        pendingResumeTimer = setTimeout(() => {
                            AutomationRuntime.cancelWorkerTask(createdTask);
                            settlePendingResume({ success: false, error: 'resume_scan_timeout' });
                        }, Math.max(1000, Number(OPTIONS.resumeScanTimeout) || 120000));
                    });
                    if (!task.opened) {
                        AutomationRuntime.cancelWorkerTask(task);
                        settlePendingResume({ success: false, error: 'resume_window_blocked' });
                    }
                });
                if (result.success) logger.add('本轮简历请求扫描完成');
                else if (!result.stopped) logger.add(`本轮简历请求扫描失败${result.error ? `: ${result.error}` : ''}，不重试`);
                return !this.pause;
            };

            const pickNextKeyword = () => {
                if (!this.tags || !this.tags.length) {
                    throw new Error('未获取到岗位关键词列表');
                }
                currentTagIdx = (currentTagIdx + 1) % this.tags.length;
                return this.tags[currentTagIdx];
            };

            const runRound = async () => {
                currentRound += 1;
                const keyword = pickNextKeyword();
                logger.divider();
                logger.add(`开始第 ${currentRound} 轮`);
                logger.add(`本轮搜索关键词：${keyword}`);
                window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
                if (!await sleepUnlessPaused(600)) return;
                await search(keyword);
                if (this.pause) return;
                logger.add(`第 ${currentRound} 轮已完成搜索（关键词：${keyword}），请在 ${(OPTIONS.manualFilterWaitMs / 1000).toFixed(0)} 秒内手动选择地区、薪资等筛选条件`);
                if (!await sleepUnlessPaused(OPTIONS.manualFilterWaitMs)) return;
                if (!await preloadJobs() || this.pause) return;
                if (!await processRoundJobs()) return false;
                await processResumeRequests();
                if (this.pause) return false;
                logger.add(`第 ${currentRound} 轮已完成：岗位逐份处理与简历请求扫描均已结束`);
                return true;
            };

            const runHourlyLoop = async () => {
                while (!this.pause) {
                    const readyTime = await scheduler.waitForNextRound(
                        hasCompletedRound,
                        (msg) => logger.add(msg),
                        () => this.pause
                    );
                    if (readyTime === null || this.pause) return;
                    if (!await runRound()) return;
                    hasCompletedRound = true;
                }
            };

            const initialize = async () => {
                logger.add('--程序启动--');
                startBroadcast();
                const clientConfig = await api.getClientConfig().catch(() => null);
                if (!clientConfig
                    || !clientConfig.frontend
                    || !clientConfig.schedule
                    || !Array.isArray(clientConfig.tags)
                    || !clientConfig.tags.length
                    || typeof clientConfig.introduce !== 'string'
                    || !clientConfig.introduce) {
                    logger.add('获取统一配置失败，程序停止');
                    AutomationRuntime.stop();
                    this.pause = true;
                    logger.setRunning(false);
                    return;
                }
                Object.assign(OPTIONS, clientConfig.frontend);
                AutomationRuntime.setClientConfig(clientConfig);
                this.tags = clientConfig.tags;
                scheduler = new HourlyScheduler(clientConfig.schedule);
                logger.add('获取前端配置成功');
                logger.add('获取标签成功: ' + this.tags.join('、'));
                logger.add('获取自我介绍成功');
                if (typeof tagIdx === 'number' && this.tags.length) {
                    currentTagIdx = ((tagIdx % this.tags.length) + this.tags.length) % this.tags.length - 1;
                }
                initialized = true;
            };

            const startController = (runId = AutomationRuntime.getRunId()) => {
                if (controllerPromise) {
                    queuedStartRunId = runId;
                    return controllerPromise;
                }
                controllerPromise = (async () => {
                    if (!initialized) await initialize();
                    if (initialized && !this.pause) await runHourlyLoop();
                })().catch((e) => {
                    logger.add(`任务执行出错: ${e?.message || String(e)}`);
                    logger.stop();
                }).finally(() => {
                    controllerPromise = null;
                    if (!queuedStartRunId || !AutomationRuntime.isRunning()) return;
                    const nextRunId = queuedStartRunId;
                    queuedStartRunId = '';
                    this.pause = false;
                    startController(nextRunId);
                });
                return controllerPromise;
            };

            const init = () => {
                if (window.name === this.targets.search && AutomationRuntime.isRunning()) {
                    logger.runBtn.click();
                }
            };

            init();
        }

        // 详情页
        __detail() {
            if (window.name !== this.targets.detail) return;
            const worker = this.__createWorkerContext(this.targets.detail, '职位详情工作页');
            if (!worker) return;

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
            if (worker.isStopped()) {
                this.broadcast.send(this.targets.search, this.bcTypes.GET_JOB_INFO, {
                    taskId: worker.task.id,
                    skip: true,
                    skipReason: '任务已由搜索页结束',
                });
                worker.complete('已停止');
                return;
            }
            try {
                const jobInfo = getJobInfo();
                this.broadcast.send(this.targets.search, this.bcTypes.GET_JOB_INFO, {
                    ...jobInfo,
                    taskId: worker.task.id,
                });
                worker.complete();
            } catch (e) {
                this.broadcast.send(this.targets.search, this.bcTypes.GET_JOB_INFO, {
                    taskId: worker.task.id,
                    skip: true,
                    skipReason: `读取职位详情失败: ${e}`,
                });
                worker.complete('执行失败');
            }
        }

        // 聊天页
        async __chat() {
            const role = window.name;
            const isGreetWorker = role === this.targets.chatGreet;
            const isResumeWorker = role === this.targets.chat;
            // 用户手动打开的消息页不属于自动化流程，脚本不接管该页面。
            if (!isGreetWorker && !isResumeWorker) return;
            const worker = this.__createWorkerContext(
                role,
                isGreetWorker ? '打招呼工作页' : '简历回复工作页'
            );
            if (!worker) return;
            let logger = isResumeWorker
                ? new Logger(null, null, { persist: false, loadShared: false })
                : null;
            if (logger) {
                logger.runBtn.remove();
                logger.clearBtn.remove();
            }

            const assertWorkerAvailable = () => {
                assertWorkerRunning(worker.isStopped);
            };
            const loadWorkerConfig = async () => {
                const cachedConfig = AutomationRuntime.getClientConfig();
                const clientConfig = cachedConfig || await new Api().getClientConfig();
                if (clientConfig?.frontend) Object.assign(OPTIONS, clientConfig.frontend);
                return clientConfig;
            };

            const fillChatInput = (input, text) => {
                input.focus({ preventScroll: true });
                input.innerText = text;
                try {
                    input.dispatchEvent(new InputEvent('input', {
                        bubbles: true,
                        inputType: 'insertText',
                        data: text,
                    }));
                } catch (e) {
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                }
                input.dispatchEvent(new Event('change', { bubbles: true }));
            };

            const findReadySendButton = async (text) => {
                const deadline = Date.now() + 4000;
                while (Date.now() < deadline) {
                    assertWorkerAvailable();
                    const input = document.querySelector(SELECTORS.ZHIPIN.CHAT.CHATINPUT);
                    if (input && input.innerText.trim() !== text.trim()) {
                        fillChatInput(input, text);
                    }
                    const buttons = Array.from(document.querySelectorAll(SELECTORS.ZHIPIN.CHAT.MSGSEND));
                    const enabledButtons = buttons.filter((button) => (
                        !button.disabled
                        && button.getAttribute('aria-disabled') !== 'true'
                        && !button.classList.contains('disabled')
                    ));
                    const button = enabledButtons.find((candidate) => candidate.getClientRects().length > 0)
                        || enabledButtons.at(-1);
                    if (input && button) return button;
                    await tools.asyncSleep(100);
                }
                throw new Error('send_button_not_ready');
            };

            const waitForMessageSent = async () => {
                const deadline = Date.now() + 4000;
                while (Date.now() < deadline) {
                    assertWorkerAvailable();
                    const input = document.querySelector(SELECTORS.ZHIPIN.CHAT.CHATINPUT);
                    if (!input || !input.innerText.trim()) return;
                    await tools.asyncSleep(100);
                }
                throw new Error('message_send_not_confirmed');
            };

            // 发送消息：重新确认当前输入框与按钮，避免标签页切换触发页面重绘后引用失效。
            const sendMsg = async (text) => {
                assertWorkerAvailable();
                const input = await tools.endlessFind(SELECTORS.ZHIPIN.CHAT.CHATINPUT);
                assertWorkerAvailable();
                fillChatInput(input, text);
                const button = await findReadySendButton(text);
                assertWorkerAvailable();
                button.click();
                await waitForMessageSent();
            };

            // 打招呼
            const sayHi = async () => {
                try {
                    assertWorkerRunning(worker.isStopped);
                    const clientConfig = await loadWorkerConfig();
                    assertWorkerRunning(worker.isStopped);
                    if (!clientConfig || typeof clientConfig.introduce !== 'string' || !clientConfig.introduce) {
                        throw new Error('missing_introduce');
                    }
                    await sendMsg(clientConfig.introduce);
                    worker.complete();
                    await this.broadcast.send(this.targets.search, this.bcTypes.SAY_HI, {
                        success: true,
                        taskId: worker.task.id,
                    });
                } catch (e) {
                    const stopped = worker.isStopped();
                    worker.complete(stopped ? '已停止' : '执行失败');
                    await this.broadcast.send(this.targets.search, this.bcTypes.SAY_HI, {
                        success: false,
                        stopped,
                        error: e?.message || String(e),
                        taskId: worker.task.id,
                    });
                } finally {
                    this.broadcast.destroy();
                }
            };

            // 获取聊天记录信息
            const getChatInfo = async () => {
                assertWorkerAvailable();
                const ctn = await tools.endlessFind(SELECTORS.ZHIPIN.CHAT.HISTORYCTN);

                const hasSentResume = () => Array.from(ctn.querySelectorAll('.boss-green'))
                    .some((el) => el.innerText.indexOf('点击预览附件简历') !== -1);

                const getLatestActivity = () => {
                    const lis = Array.from(ctn.querySelectorAll(SELECTORS.ZHIPIN.CHAT.USEFULMSG));
                    const messages = lis.map((li) => {
                        const role = li.classList.contains('item-friend') ? 'user' : 'assistant';
                        const msgBox = li.querySelector(SELECTORS.ZHIPIN.CHAT.MSGCONTENT);
                        if (!msgBox) return null;
                        return {
                            element: li,
                            role,
                            content: msgBox.innerText,
                            type: 'message',
                        };
                    }).filter(Boolean);
                    const requestCards = Array.from(ctn.querySelectorAll('.boss-green'))
                        .filter((el) => el.innerText.indexOf('我想要一份您的附件简历') !== -1)
                        .map((element) => ({ element, type: 'resume_request_card' }));
                    const timeline = [...messages, ...requestCards].sort((left, right) => {
                        if (left.element === right.element) return 0;
                        const position = left.element.compareDocumentPosition(right.element);
                        return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
                    });
                    const latest = timeline.at(-1);
                    return {
                        lastMsg: latest?.type === 'message'
                            ? { role: latest.role, content: latest.content }
                            : null,
                        hasResumeRequestCard: latest?.type === 'resume_request_card',
                    };
                };

                const scroll2Top = async () => {
                    assertWorkerAvailable();
                    if (ctn.scrollTop === 0) return;
                    ctn.scrollTop = 0;
                    await tools.asyncSleep(300);
                    await scroll2Top();
                };

                // 先在消息底部锁定最新活动，再加载历史记录判断是否发过简历。
                await tools.asyncSleep(300);
                ctn.scrollTop = ctn.scrollHeight;
                await tools.asyncSleep(300);
                const latestActivity = getLatestActivity();
                let resumeSended = hasSentResume();
                await scroll2Top();
                resumeSended = resumeSended || hasSentResume();
                return {
                    ...latestActivity,
                    resumeSended,
                };
            };

            // 发送简历：只负责发送附件，成功后由调用方单独回复
            const sendResume = async (resumeIndex = OPTIONS.resumeIndex) => {
                assertWorkerAvailable();
                const sendBtn = await tools.endlessFind(SELECTORS.ZHIPIN.CHAT.RESUMESEND);
                assertWorkerAvailable();
                sendBtn.click();

                // 可能是弹一个小窗
                const smallDialog = await tools.endlessFind(SELECTORS.ZHIPIN.CHAT.RESUMEMODAL).catch(() => null);
                if (smallDialog) {
                    assertWorkerAvailable();
                    smallDialog.querySelector(SELECTORS.ZHIPIN.CHAT.RESUMEMODALCONFIRM).click();
                    return;
                }

                // 弹出大窗让选择
                const resumeCtn = await tools.endlessFind(SELECTORS.ZHIPIN.CHAT.RESUMELIST);
                const confirm = await tools.endlessFind(SELECTORS.ZHIPIN.CHAT.RESUMESENDCONFIRM);
                const resumes = resumeCtn.querySelectorAll(SELECTORS.ZHIPIN.CHAT.RESUMELISTITEM);
                const fallbackIndex = resumes[resumeIndex] ? resumeIndex : (resumes[OPTIONS.resumeIndex] ? OPTIONS.resumeIndex : 0);
                const resume = resumes[fallbackIndex];
                await tools.asyncSleep(300);
                assertWorkerAvailable();
                resume.click();
                await tools.asyncSleep(300);
                assertWorkerAvailable();
                confirm.click();
            };

            // 判断最新 HR 消息是否明确索要简历：否定规则优先
            const isExplicitResumeRequest = (message) => {
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

            // 给搜索页同步状态
            const status = (text) => {
                logger && logger.add(text, false);
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
                // 一轮
                let round = 0;
                let lastTop = 0;
                const once = async () => {
                    assertWorkerAvailable();
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
                            assertWorkerAvailable();
                            // 无新消息
                            if (!ls.querySelector(SELECTORS.ZHIPIN.CHAT.NEWMSGNOTICE)) continue;
                            // 获取联系人信息
                            const name = ls.querySelector(SELECTORS.ZHIPIN.CHAT.USERNAME);
                            const company = name.nextElementSibling.innerText;
                            divider();
                            status(`[${company} - ${name.innerText}] 发来一条新消息`);
                            // 进入聊天界面
                            assertWorkerAvailable();
                            name.click();
                            // 获取聊天记录信息
                            const chatInfo = await getChatInfo();
                            const lastMsg = chatInfo.lastMsg;
                            // 已发过简历的会话不再执行任何自动处理
                            if (chatInfo.resumeSended) {
                                status('已发过简历，该会话不再自动处理');
                                continue;
                            }
                            // 只有最新 HR 消息明确索要简历，或存在 Boss 索要简历卡片时才发送
                            const hasExplicitTextRequest = lastMsg
                                && lastMsg.role === 'user'
                                && isExplicitResumeRequest(lastMsg.content);
                            if (!hasExplicitTextRequest && !chatInfo.hasResumeRequestCard) {
                                status('未检测到明确索要简历，不自动处理');
                                continue;
                            }
                            status(`正在发送简历（简历索引 ${OPTIONS.resumeIndex}）`);
                            assertWorkerAvailable();
                            await sendResume(OPTIONS.resumeIndex);
                            assertWorkerAvailable();
                            await sendMsg('发给您了哈');
                            status('发送成功');
                        } catch (e) {
                            if (e?.message === 'automation_stopped') throw e;
                            status('回复某条消息出错');
                        }
                    }
                    // 向下滚动
                    assertWorkerAvailable();
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
                if (isGreetWorker) {
                    await sayHi();
                    return;
                }
                let success = true;
                let completeState = '任务已完成';
                try {
                    await loadWorkerConfig();
                    await tools.asyncSleep(3000);
                    assertWorkerAvailable();
                    await chat();
                    status('消息处理完毕');
                } catch (e) {
                    if (e?.message === 'automation_stopped') {
                        completeState = '已停止';
                        status('搜索页已结束任务，本轮消息处理停止');
                    } else {
                        success = false;
                        completeState = '执行失败';
                        status('聊天程序运行出错');
                    }
                } finally {
                    worker.complete(completeState);
                    await this.broadcast.send(this.targets.search, this.bcTypes.RUN, {
                        success,
                        taskId: worker.task.id,
                    });
                    this.broadcast.destroy();
                }
            };
            await main();
        }

        // 运行
        run(tagIdx = 0) {
            const path = location.pathname;
            // 在搜索页
            if (path.startsWith(SEARCHPATH.zhipin)) {
                this.__search(tagIdx);
            }
            // 在详情页
            else if (path.startsWith(this.whiteList.detail)) {
                this.__detail();
            }
            // 在聊天页
            else if (path.startsWith(this.whiteList.chat)) {
                this.__chat();
            }
            // 否则跳转搜索页
            else {
                new Logger(() => {
                    AutomationRuntime.start();
                    tools.openControllerPage(SEARCHPATH.zhipin, this.targets.search);
                });
            }
        }
    }

    const jobApplyScheduler = new Zhipin().run();
})();
