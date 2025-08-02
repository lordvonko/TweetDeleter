(async function() {
    'use strict';


    const DellTweet = {
        // Optimized configurations
        config: {
            deleteDelay: 100,        // Base delay between deletions
            concurrency: 2,          // Initial concurrency, dynamically adjusted
            maxDate: null,
            theme: 'dark',
            maxRetries: 3,
            rateLimitWait: 60,       // Base time for rate limit
            testMode: false,
            maxFailed: 20,           // Limit of failures before stopping
            pauseEvery: 100,         // Pause every N tweets
            pauseDuration: 2000      // Pause duration
        },

        // State
        state: {
            running: false,
            paused: false,
            stats: {
                found: 0,
                toDelete: 0,
                deleted: 0,
                skipped: 0,
                protected: 0,
                failed: 0,
                startTime: null
            },
            cache: new Map(),
            tweetsToProcess: [],
            failedIds: [],           // Tracks failed IDs for export and resume
            processedCount: 0,
            rateLimitReset: null,
            lastSuccessRate: 1.0
        },

        // Protected tweet IDs
        protectedIds: [
            '',    //
            ''     // 
        ],

        // Headers
        headers: {},

        // Initialization
        async init() {
            console.log('🚀 DellTweet v2.7 - Fixed 403 error with updated headers');
            console.log(`🛡️ Protected tweets: ${this.protectedIds.length}`);

            if (window.DellTweet_Instance) {
                window.DellTweet_Instance.close();
            }

            if (!window.location.href.includes('x.com') && !window.location.href.includes('twitter.com')) {
                alert('This script must be run on x.com or twitter.com');
                return;
            }

            const ct0 = this.getCookie('ct0');
            if (!ct0) {
                alert('Error: CSRF token not found. Reload the page and log in again.');
                return;
            }

            this.headers = {
                'x-csrf-token': ct0,  // Fixed: use 'x-csrf-token' instead of 'ct0'
                'authorization': this.extractAuthToken() || 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
                'content-type': 'application/json',  // Added: required header
                'x-twitter-active-user': 'yes',      // Added: header for active user
                'x-twitter-auth-type': 'OAuth2Session'  // Added: auth type
            };

            this.createUI();
            this.setupEventListeners();

            // Load failedIds from localStorage for resume
            const storedFailed = localStorage.getItem('delltweet-failed');
            if (storedFailed) {
                this.state.failedIds = JSON.parse(storedFailed);
                if (this.state.failedIds.length > 0 && confirm(`Resume ${this.state.failedIds.length} failed tweets?`)) {
                    this.state.tweetsToProcess = this.state.failedIds.map(id => ({ id, date: new Date() })); // Dummy date for resume
                    this.updateStatus(`✅ ${this.state.tweetsToProcess.length} failed tweets loaded for retry`);
                    this.state.cache.get('btn-start').disabled = false;
                }
            }

            window.DellTweet_Instance = this;
            console.log('✅ Interface ready! Upload the tweet.js file');
        },

        // Get cookie
        getCookie(name) {
            const match = document.cookie.match(new RegExp('(^|\\s)' + name + '=([^;]+)'));
            return match ? match[2] : null;
        },

        // Extract authorization token
        extractAuthToken() {
            const scripts = document.querySelectorAll('script');
            for (const script of scripts) {
                const match = script.textContent.match(/Bearer\s([A-Za-z0-9%]+={0,2})/);
                if (match) return `Bearer ${match[1]}`;
            }
            return null;
        },

        // Create improved interface
        createUI() {
            const ui = document.createElement('div');
            ui.id = 'deltweet-ui';
            ui.innerHTML = `
                <style>
                    #deltweet-ui {
                        position: fixed;
                        top: 20px;
                        right: 20px;
                        width: 400px;
                        max-height: 80vh;
                        overflow-y: auto;
                        background: #1e1e1e;
                        color: #fff;
                        border: 1px solid #444;
                        border-radius: 8px;
                        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
                        padding: 20px;
                        z-index: 9999;
                        font-family: Arial, sans-serif;
                        scrollbar-width: thin;
                    }
                    #deltweet-ui::-webkit-scrollbar {
                        width: 6px;
                    }
                    #deltweet-ui::-webkit-scrollbar-thumb {
                        background: #555;
                        border-radius: 3px;
                    }
                    #deltweet-ui h2 {
                        margin: 0 0 10px;
                        font-size: 18px;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                    }
                    #deltweet-ui .form-group {
                        margin-bottom: 15px;
                    }
                    #deltweet-ui label {
                        display: block;
                        margin-bottom: 5px;
                        font-size: 14px;
                    }
                    #deltweet-ui input[type="file"], #deltweet-ui input[type="date"] {
                        width: 100%;
                        padding: 8px;
                        background: #333;
                        color: #fff;
                        border: 1px solid #555;
                        border-radius: 4px;
                    }
                    #deltweet-ui .checkbox-group {
                        display: flex;
                        flex-direction: column;
                    }
                    #deltweet-ui .checkbox-group label {
                        display: flex;
                        align-items: center;
                        margin-bottom: 5px;
                    }
                    #deltweet-ui .checkbox-group input {
                        margin-right: 10px;
                    }
                    #deltweet-ui .protected-tweets {
                        margin-bottom: 15px;
                        max-height: 150px;
                        overflow-y: auto;
                    }
                    #deltweet-ui .protected-list {
                        font-size: 12px;
                        color: #aaa;
                    }
                    #deltweet-ui .warning {
                        color: #ffcc00;
                        font-size: 12px;
                        margin-bottom: 15px;
                    }
                    #deltweet-ui .stats {
                        margin-bottom: 15px;
                    }
                    #deltweet-ui .stat-line {
                        display: flex;
                        justify-content: space-between;
                        padding: 2px 0;
                        font-size: 13px;
                    }
                    #deltweet-ui .progress-bar {
                        height: 8px;
                        background: #333;
                        border-radius: 4px;
                        overflow: hidden;
                        margin-bottom: 10px;
                    }
                    #deltweet-ui .progress-fill {
                        height: 100%;
                        background: #1da1f2;
                        transition: width 0.3s ease;
                    }
                    #deltweet-ui .status {
                        font-size: 13px;
                        margin-bottom: 15px;
                        min-height: 20px;
                    }
                    #deltweet-ui button {
                        width: 100%;
                        padding: 10px;
                        margin-bottom: 10px;
                        background: #1da1f2;
                        color: #fff;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 14px;
                        transition: background 0.2s;
                    }
                    #deltweet-ui button:hover {
                        background: #0c85d0;
                    }
                    #deltweet-ui button:disabled {
                        background: #555;
                        cursor: not-allowed;
                    }
                    #deltweet-ui .btn-stop, #deltweet-ui .btn-pause {
                        background: #ff4d4d;
                    }
                    #deltweet-ui .btn-stop:hover, #deltweet-ui .btn-pause:hover {
                        background: #cc0000;
                    }
                    #deltweet-ui .btn-export {
                        background: #4caf50;
                    }
                    #deltweet-ui .btn-export:hover {
                        background: #388e3c;
                    }
                    #deltweet-ui .btn-close {
                        background: #777;
                        width: auto;
                        padding: 5px 10px;
                        font-size: 12px;
                        position: absolute;
                        top: 10px;
                        right: 10px;
                    }
                    #tk-debug {
                        background: #000;
                        color: #0f0;
                        font-family: monospace;
                        font-size: 12px;
                        max-height: 200px;
                        overflow-y: auto;
                        padding: 10px;
                        border-top: 1px solid #444;
                        margin-top: 10px;
                    }
                </style>
                <h2>🗑️ DellTweet <span class="version">v2.7</span></h2>
                <div class="form-group">
                    <label for="tk-file">📁 Select the tweet.js file:</label>
                    <input type="file" id="tk-file" accept=".js,.json">
                    <div class="file-info" id="tk-file-info"></div>
                </div>
                <div class="form-group">
                    <label for="tk-date">📅 Delete tweets before:</label>
                    <input type="date" id="tk-date">
                </div>
                <div class="checkbox-group">
                    <label><input type="checkbox" id="tk-keep-recent" checked>Keep last 7 days</label>
                    <label><input type="checkbox" id="tk-delete-all">Delete ALL</label>
                    <label><input type="checkbox" id="tk-test-mode">Test Mode</label>
                    <label><input type="checkbox" id="tk-debug-mode">Debug Mode</label>
                </div>
                <div class="protected-tweets">
                    <h4>🛡️ Protected Tweets (${this.protectedIds.length})</h4>
                    <div class="protected-list">${this.protectedIds.map((id, index) => `${index + 1}. ${id}`).join('<br>')}</div>
                </div>
                <div class="warning">⚠️ Irreversible action! Make a backup.</div>
                <div class="stats" id="tk-stats">
                    <div class="stat-line"><span>🔍 Found:</span><strong id="stat-found">0</strong></div>
                    <div class="stat-line"><span>🎯 To Delete:</span><strong id="stat-todelete">0</strong></div>
                    <div class="stat-line"><span>✅ Deleted:</span><strong id="stat-deleted">0</strong></div>
                    <div class="stat-line"><span>⏭️ Skipped:</span><strong id="stat-skipped">0</strong></div>
                    <div class="stat-line"><span>🛡️ Protected:</span><strong id="stat-protected">0</strong></div>
                    <div class="stat-line"><span>❌ Failed:</span><strong id="stat-failed">0</strong></div>
                    <div class="stat-line"><span>⚡ Speed:</span><strong id="stat-speed">0/min</strong></div>
                    <div class="stat-line"><span>⏱️ Time:</span><strong id="stat-elapsed">00:00</strong></div>
                </div>
                <div class="progress-bar" id="tk-progress-bar"><div class="progress-fill" id="tk-progress-fill"></div></div>
                <div class="status" id="tk-status">Waiting for file...</div>
                <button class="btn-start" id="tk-btn-start" disabled>🚀 START</button>
                <button class="btn-stop" id="tk-btn-stop">⏹️ STOP</button>
                <button class="btn-pause" id="tk-btn-pause">⏸️ PAUSE</button>
                <button class="btn-export" id="tk-btn-export">📊 EXPORT</button>
                <button class="btn-close" id="tk-btn-close">✕</button>
            `;
            document.body.appendChild(ui);
            this.populateCache();
        },

        // Populate cache with all elements
        populateCache() {
            const elements = ['stats', 'btn-start', 'btn-stop', 'btn-pause', 'btn-export', 'btn-close', 'status', 'file-info', 'progress-bar', 'progress-fill'];
            elements.forEach(id => this.state.cache.set(id, document.getElementById(`tk-${id}`)));
            ['found', 'todelete', 'deleted', 'skipped', 'protected', 'failed', 'speed', 'elapsed'].forEach(stat => this.state.cache.set(`stat-${stat}`, document.getElementById(`stat-${stat}`)));
        },

        // Setup events
        setupEventListeners() {
            const cache = this.state.cache;
            cache.get('btn-start').addEventListener('click', () => this.start());
            cache.get('btn-stop').addEventListener('click', () => this.stop());
            cache.get('btn-pause').addEventListener('click', () => this.togglePause());
            cache.get('btn-export').addEventListener('click', () => this.exportReport());
            cache.get('btn-close').addEventListener('click', () => this.close());

            document.getElementById('tk-delete-all').addEventListener('change', (e) => {
                document.getElementById('tk-date').disabled = e.target.checked;
                document.getElementById('tk-keep-recent').disabled = e.target.checked;
                if (e.target.checked) document.getElementById('tk-keep-recent').checked = false;
            });

            document.getElementById('tk-test-mode').addEventListener('change', (e) => {
                this.config.testMode = e.target.checked;
                this.updateStatus(this.config.testMode ? '🧪 Test mode activated' : '💫 Test mode deactivated');
            });

            document.getElementById('tk-debug-mode').addEventListener('change', (e) => {
                const debugEl = document.createElement('div');
                debugEl.id = 'tk-debug';
                if (e.target.checked) {
                    debugEl.classList.add('active');
                    this.state.cache.set('debug', debugEl);
                    document.getElementById('deltweet-ui').appendChild(debugEl);
                } else if (this.state.cache.get('debug')) {
                    this.state.cache.get('debug').remove();
                    this.state.cache.delete('debug');
                }
            });

            document.getElementById('tk-file').addEventListener('change', (e) => this.processFile(e.target.files[0]));
            document.getElementById('tk-date').value = new Date(Date.now() - 31536000000).toISOString().split('T')[0];

            setInterval(() => {
                if (this.state.running && this.state.stats.startTime) {
                    const elapsed = Date.now() - this.state.stats.startTime;
                    const minutes = Math.floor(elapsed / 60000);
                    const seconds = Math.floor((elapsed % 60000) / 1000);
                    this.state.cache.get('stat-elapsed').textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
                }
            }, 1000);
        },

        // Debug function (with scroll)
        debug(message, data = null) {
            if (!document.getElementById('tk-debug-mode')?.checked || !this.state.cache.get('debug')) return;
            const debugEl = this.state.cache.get('debug');
            const timestamp = new Date().toLocaleTimeString();
            const line = `[${timestamp}] ${message}${data ? '\n' + JSON.stringify(data, null, 2) : ''}\n`;
            debugEl.textContent = line + debugEl.textContent;
            if (debugEl.textContent.split('\n').length > 50) debugEl.textContent = debugEl.textContent.split('\n').slice(0, 50).join('\n');
            debugEl.scrollTop = 0; // Scroll to top for new messages
            console.log(`[Debug] ${message}`, data || '');
        },

        // Process file (with fallback to FileReader)
        async processFile(file) {
            if (!file) {
                this.updateStatus('❌ No file selected.');
                return;
            }

            const btnStart = this.state.cache.get('btn-start');
            const fileInfo = this.state.cache.get('file-info');
            btnStart.disabled = true;
            this.updateStatus('🔄 Analyzing file...');

            if (fileInfo) {
                fileInfo.innerHTML = `📄 ${file.name}<br>📏 ${(file.size / 1024).toFixed(2)} KB<br>🕒 ${new Date(file.lastModified).toLocaleDateString('en-US')}`;
                fileInfo.classList.add('active');
            }

            this.debug(`Processing ${file.name} (${file.size} bytes)`);

            let content = '';
            try {
                if (file.stream) {
                    // Streaming for large files
                    const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
                    let chunk;
                    while (!(chunk = await reader.read()).done) {
                        content += chunk.value;
                        if (content.length > 1024 * 1024 * 10) throw new Error('File too large (>10MB chunk).'); // Safety limit
                    }
                } else {
                    // Fallback FileReader
                    content = await new Promise((resolve, reject) => {
                        const fr = new FileReader();
                        fr.onload = () => resolve(fr.result);
                        fr.onerror = reject;
                        fr.readAsText(file);
                    });
                }
            } catch (error) {
                this.debug('Reading error:', error);
                this.updateStatus(`❌ Reading error: ${error.message}`);
                return;
            }

            try {
                let jsonString = null;
                const patterns = [/window\.YTD\.tweets\.part\d+\s*=\s*(\[[\s\S]*\])/, /window\.YTD\.tweet\.part\d+\s*=\s*(\[[\s\S]*\])/, /^\[[\s\S]*\]$/];
                for (let pattern of patterns) {
                    const match = content.match(pattern);
                    if (match) {
                        jsonString = match[1] || match[0];
                        this.debug(`Format detected: ${pattern}`);
                        break;
                    }
                }

                if (!jsonString) {
                    const jsonStart = content.indexOf('[');
                    if (jsonStart !== -1) jsonString = content.substring(jsonStart);
                }

                if (!jsonString) throw new Error('JSON not detected.');

                const json = JSON.parse(jsonString);
                if (!Array.isArray(json)) throw new Error('Not an array of tweets.');

                const tweetsData = json.map(item => {
                    const tweet = item.tweet || item;
                    const id = tweet.id_str || tweet.id;
                    const dateStr = tweet.created_at;
                    if (!id || !/^\d+$/.test(id)) return null; // ID validation
                    const date = dateStr ? new Date(dateStr) : new Date();
                    if (isNaN(date.getTime())) return null; // Date validation
                    return {
                        id,
                        date,
                        text: tweet.full_text || tweet.text || ''
                    };
                }).filter(Boolean);

                if (tweetsData.length === 0) throw new Error('No valid tweets found.');

                this.state.tweetsToProcess = tweetsData;

                this.updateStatus(`✅ ${tweetsData.length} tweets loaded`);
                if (fileInfo) fileInfo.innerHTML += `<br>✅ ${tweetsData.length} tweets`;
                btnStart.disabled = false;
                this.debug(`Processing completed: ${tweetsData.length} tweets.`);

            } catch (error) {
                this.debug('Processing error:', error);
                this.updateStatus(`❌ ${error.message}`);
                alert(error.message + '\n💡 Check if it is the correct tweet.js.');
                btnStart.disabled = true;
            }
        },

        // Start process (with upfront filter)
        async start() {
            if (this.state.tweetsToProcess.length === 0) {
                alert('Load a valid tweet.js file or resume failures.');
                return;
            }

            const deleteAll = document.getElementById('tk-delete-all').checked;
            const keepRecent = document.getElementById('tk-keep-recent').checked;
            const selectedDate = document.getElementById('tk-date').value;

            if (!deleteAll && !selectedDate) {
                alert('Select a date or "Delete ALL".');
                return;
            }

            this.config.maxDate = deleteAll ? null : new Date(selectedDate);
            if (keepRecent && !deleteAll) {
                const sevenDaysAgo = new Date();
                sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
                if (!this.config.maxDate || this.config.maxDate > sevenDaysAgo) this.config.maxDate = sevenDaysAgo;
            }

            // Upfront filter
            const protectedTweets = this.state.tweetsToProcess.filter(t => this.protectedIds.includes(t.id));
            const toDelete = this.state.tweetsToProcess.filter(t => !this.protectedIds.includes(t.id) && (!this.config.maxDate || t.date <= this.config.maxDate));
            const skipped = this.state.tweetsToProcess.length - protectedTweets.length - toDelete.length;

            if (!confirm(`Delete ${toDelete.length} tweets? (${protectedTweets.length} protected, ${skipped} skipped)`)) return;

            this.state.tweetsToProcess = toDelete;
            this.state.failedIds = [];
            this.state.stats = {
                found: this.state.tweetsToProcess.length + skipped + protectedTweets.length,
                toDelete: toDelete.length,
                deleted: 0,
                skipped: skipped,
                protected: protectedTweets.length,
                failed: 0,
                startTime: Date.now()
            };
            this.state.running = true;
            this.state.paused = false;
            this.state.processedCount = 0;

            const cache = this.state.cache;
            cache.get('stats').classList.add('active');
            cache.get('progress-bar').classList.add('active');
            cache.get('btn-start').style.display = 'none';
            cache.get('btn-stop').style.display = 'block';
            cache.get('btn-pause').style.display = 'block';

            this.updateStats();
            this.updateProgress();
            this.updateStatus('🔄 Starting deletion...');
            await this.deleteLoop();
        },

        // Main loop with limited concurrency and async iterator
        async deleteLoop() {
            const tweets = [...this.state.tweetsToProcess];
            if (tweets.length === 0) return this.showCompletionSummary();

            // Concurrency limiter implementation
            let concurrency = this.config.concurrency;
            let index = 0;
            const results = new Array(tweets.length);
            const workers = Array(concurrency).fill(Promise.resolve()).map(() => async () => {
                while (this.state.running && index < tweets.length) {
                    if (this.state.paused) {
                        await this.sleep(1000);
                        continue;
                    }
                    const i = index++;
                    try {
                        results[i] = await this.processTweet(tweets[i]);
                    } catch {} // Ignore errors, handled in processTweet
                    this.state.processedCount++;
                    this.updateProgress();
                    await this.sleep(this.config.deleteDelay);

                    if (this.state.processedCount % this.config.pauseEvery === 0) {
                        this.updateStatus(`⏸️ Pause (${this.config.pauseDuration / 1000}s)...`);
                        await this.sleep(this.config.pauseDuration);
                    }
                }
            });

            await Promise.all(workers.map(w => w()));

            // Dynamic concurrency adjustment
            const successRate = this.state.stats.deleted / (this.state.stats.deleted + this.state.stats.failed || 1);
            this.state.lastSuccessRate = successRate;
            this.config.concurrency = Math.max(1, Math.min(5, Math.round(this.config.concurrency * successRate)));

            if (this.state.stats.failed > this.config.maxFailed) {
                this.updateStatus('❌ Too many failures, stopping...');
                this.stop();
            }

            if (this.state.running) {
                this.showCompletionSummary();
                this.stop();
            }

            // Save failedIds for resume
            if (this.state.failedIds.length > 0) {
                localStorage.setItem('delltweet-failed', JSON.stringify(this.state.failedIds));
            } else {
                localStorage.removeItem('delltweet-failed');
            }
        },

        // Process tweet (with retry and backoff)
        async processTweet(tweetData) {
            const tweetId = tweetData.id;

            if (this.config.testMode) {
                await this.sleep(500); // Simulate delay
                this.state.stats.deleted++;
                this.updateStatus(`🧪 Simulated: ${tweetId}`);
                this.updateStats();
                return true;
            }

            let success = false;
            for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
                try {
                    success = await this.deleteTweet(tweetId);
                    if (success) break;
                    await this.sleep(1000 * Math.pow(2, attempt - 1)); // Exponential backoff
                } catch (error) {
                    this.debug(`Unexpected error in ${tweetId}:`, error);
                }
            }

            if (success) {
                this.state.stats.deleted++;
            } else {
                this.state.stats.failed++;
                this.state.failedIds.push(tweetId);
            }

            this.updateStats();
            return success;
        },

        // Delete tweet (with simulation in test mode and robust handling)
        async deleteTweet(tweetId) {
            try {
                const response = await fetch('https://x.com/i/api/graphql/VaenaVgh5q5ih7kvyVjgtg/DeleteTweet', {
                    method: 'POST',
                    headers: {
                        ...this.headers,
                        'x-client-transaction-id': crypto.randomUUID() || `${Math.random().toString(36).slice(2)}-${Date.now()}` // Fallback for older browsers
                    },
                    credentials: 'include',
                    body: JSON.stringify({
                        variables: { tweet_id: tweetId, dark_request: false },
                        queryId: 'VaenaVgh5q5ih7kvyVjgtg'
                    })
                });

                const rateLimitReset = response.headers.get('x-rate-limit-reset');
                if (rateLimitReset) this.state.rateLimitReset = new Date(parseInt(rateLimitReset) * 1000);

                if (response.status === 200 || response.status === 404) { // 404: already deleted
                    return true;
                }
                if (response.status === 429) {
                    await this.handleRateLimit();
                    return false;
                }

                const data = await response.json().catch(() => ({}));
                this.debug(`HTTP ${response.status} for ${tweetId}:`, data);
                return false;

            } catch (error) {
                this.debug(`Network error in ${tweetId}:`, error);
                return false;
            }
        },

        // Handle rate limit (with backoff)
        async handleRateLimit() {
            let waitTime = this.config.rateLimitWait;
            if (this.state.rateLimitReset) {
                waitTime = Math.max(waitTime, (this.state.rateLimitReset - new Date()) / 1000);
            }
            for (let i = waitTime; i > 0 && this.state.running; i--) {
                this.updateStatus(`⏰ Rate limit: ${Math.ceil(i)}s remaining...`);
                await this.sleep(1000);
            }
        },

        // Update statistics (batched DOM update)
        updateStats() {
            const cache = this.state.cache;
            const stats = this.state.stats;
            cache.get('stat-found').textContent = stats.found;
            cache.get('stat-todelete').textContent = stats.toDelete;
            cache.get('stat-deleted').textContent = stats.deleted;
            cache.get('stat-skipped').textContent = stats.skipped;
            cache.get('stat-protected').textContent = stats.protected;
            cache.get('stat-failed').textContent = stats.failed;
            if (stats.startTime) {
                const elapsed = (Date.now() - stats.startTime) / 60000;
                cache.get('stat-speed').textContent = `${Math.round(stats.deleted / elapsed || 0)}/min`;
            }
        },

        // Update progress
        updateProgress() {
            const processed = this.state.stats.deleted + this.state.stats.failed;
            const total = this.state.stats.toDelete;
            this.state.cache.get('progress-fill').style.width = `${(processed / total * 100) || 0}%`;
        },

        // Update status
        updateStatus(message) {
            this.state.cache.get('status').textContent = message;
            this.debug(message);
        },

        // Pause/Resume
        togglePause() {
            this.state.paused = !this.state.paused;
            this.updateStatus(this.state.paused ? '⏸️ Paused' : '▶️ Resumed');
            this.state.cache.get('btn-pause').textContent = this.state.paused ? '▶️ RESUME' : '⏸️ PAUSE';
        },

        // Stop process
        stop() {
            this.state.running = false;
            this.state.paused = false;
            const cache = this.state.cache;
            cache.get('btn-stop').style.display = 'none';
            cache.get('btn-pause').style.display = 'none';
            cache.get('btn-start').style.display = 'block';
            this.updateStatus('⏹️ Finished');
        },

        // Show summary
        showCompletionSummary() {
            const stats = this.state.stats;
            const duration = Date.now() - stats.startTime;
            const minutes = Math.floor(duration / 60000);
            const seconds = Math.floor((duration % 60000) / 1000);
            const summary = `✅ COMPLETED\n📊 ${stats.found} found\n🎯 ${stats.toDelete} to delete\n✅ ${stats.deleted} deleted\n⏭️ ${stats.skipped} skipped\n🛡️ ${stats.protected} protected\n❌ ${stats.failed} failed\n⏱️ ${minutes}m ${seconds}s\n⚡ ${Math.round(stats.deleted / (duration / 60000))} /min`;
            this.updateStatus('✅ Completed!');
            alert(summary);
        },

        // Export report (with failedIds)
        async exportReport() {
            const report = {
                version: '2.7',
                exportDate: new Date().toISOString(),
                stats: { ...this.state.stats },
                duration: { ms: this.state.stats.startTime ? Date.now() - this.state.stats.startTime : 0 },
                config: { maxDate: this.config.maxDate?.toISOString() || 'all', testMode: this.config.testMode, protectedIds: this.protectedIds },
                failedIds: this.state.failedIds
            };
            const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `delltweet-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
            a.click();
            URL.revokeObjectURL(url);
            this.updateStatus('📊 Report exported!');
        },

        // Close
        close() {
            if (this.state.running && !confirm('Close during execution?')) return;
            this.state.running = false;
            document.getElementById('deltweet-ui')?.remove();
            window.DellTweet_Instance = null;
            console.log('👋 Closed');
        },

        // Sleep
        sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }
    };

    await DellTweet.init();

})();
