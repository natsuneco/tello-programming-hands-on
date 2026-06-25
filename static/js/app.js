// Global variables for Blockly and execution state
let workspace = null;
let isRunning = false;
let shouldStop = false;
let currentHighlightBlockId = null;
let statusIntervalId = null;

// Cute icons and colors for logs
const LOG_THEMES = {
    system: { icon: '🤖', cssClass: 'system' },
    command: { icon: '🚀', cssClass: 'command' },
    success: { icon: '✨', cssClass: 'success' },
    error: { icon: '💥', cssClass: 'error' }
};

// --- Custom Blockly Blocks Definitions ---

// Takeoff block
Blockly.Blocks['tello_takeoff'] = {
    init: function() {
        this.appendDummyInput()
            .appendField("🚀 りりくする (とびたつ)");
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour('#ff7043');
        this.setTooltip("ドローンを1メートルまで浮かび上がらせます。");
        this.setHelpUrl("");
    }
};

// Land block
Blockly.Blocks['tello_land'] = {
    init: function() {
        this.appendDummyInput()
            .appendField("🛬 ちゃくりくする (おりる)");
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour('#ff5722');
        this.setTooltip("ドローンをその場にゆっくり着陸させます。");
        this.setHelpUrl("");
    }
};

// Move (Forward, Back, Left, Right)
Blockly.Blocks['tello_move'] = {
    init: function() {
        this.appendDummyInput()
            .appendField("➡️")
            .appendField(new Blockly.FieldDropdown([
                ["まえへ", "forward"],
                ["うしろへ", "back"],
                ["ひだりへ", "left"],
                ["みぎへ", "right"]
            ]), "dir")
            .appendField("すすむ");
        this.appendValueInput("distance")
            .setCheck("Number");
        this.appendDummyInput()
            .appendField("cm");
        this.setInputsInline(true);
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour('#29b6f6');
        this.setTooltip("20cmから500cmの間で、前後左右に動かします。");
        this.setHelpUrl("");
    }
};

// Move Up/Down
Blockly.Blocks['tello_move_updown'] = {
    init: function() {
        this.appendDummyInput()
            .appendField("↕️")
            .appendField(new Blockly.FieldDropdown([
                ["うえへ", "up"],
                ["したへ", "down"]
            ]), "dir")
            .appendField("すすむ");
        this.appendValueInput("distance")
            .setCheck("Number");
        this.appendDummyInput()
            .appendField("cm");
        this.setInputsInline(true);
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour('#0288d1');
        this.setTooltip("20cmから500cmの間で、上昇（うえ）または下降（した）させます。");
        this.setHelpUrl("");
    }
};

// Rotate Clockwise / Counter-Clockwise
Blockly.Blocks['tello_rotate'] = {
    init: function() {
        this.appendDummyInput()
            .appendField("🔄")
            .appendField(new Blockly.FieldDropdown([
                ["みぎに", "cw"],
                ["ひだりに", "ccw"]
            ]), "dir")
            .appendField("まわる");
        this.appendValueInput("degree")
            .setCheck("Number");
        this.appendDummyInput()
            .appendField("ど (度)");
        this.setInputsInline(true);
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour('#ab47bc');
        this.setTooltip("指定した角度（1度〜360度）だけ、その場で回転させます。");
        this.setHelpUrl("");
    }
};

// Wait (Seconds)
Blockly.Blocks['tello_wait'] = {
    init: function() {
        this.appendDummyInput()
            .appendField("⏱️");
        this.appendValueInput("seconds")
            .setCheck("Number");
        this.appendDummyInput()
            .appendField("びょう まつ");
        this.setInputsInline(true);
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setColour('#ffca28');
        this.setTooltip("指定した秒数だけ、ドローンをその場で停止（ホバリング）させます。");
        this.setHelpUrl("");
    }
};


// --- JavaScript Generators ---

javascript.javascriptGenerator.forBlock['tello_takeoff'] = function(block) {
    return 'await executeCommand("takeoff");\n';
};

javascript.javascriptGenerator.forBlock['tello_land'] = function(block) {
    return 'await executeCommand("land");\n';
};

javascript.javascriptGenerator.forBlock['tello_move'] = function(block) {
    const dir = block.getFieldValue('dir');
    const distance = javascript.javascriptGenerator.valueToCode(block, 'distance', javascript.javascriptGenerator.ORDER_ATOMIC) || '50';
    return `await executeCommand("move", { direction: "${dir}", distance: ${distance} });\n`;
};

javascript.javascriptGenerator.forBlock['tello_move_updown'] = function(block) {
    const dir = block.getFieldValue('dir');
    const distance = javascript.javascriptGenerator.valueToCode(block, 'distance', javascript.javascriptGenerator.ORDER_ATOMIC) || '50';
    return `await executeCommand("move", { direction: "${dir}", distance: ${distance} });\n`;
};

javascript.javascriptGenerator.forBlock['tello_rotate'] = function(block) {
    const dir = block.getFieldValue('dir');
    const degree = javascript.javascriptGenerator.valueToCode(block, 'degree', javascript.javascriptGenerator.ORDER_ATOMIC) || '90';
    return `await executeCommand("rotate", { direction: "${dir}", degree: ${degree} });\n`;
};

javascript.javascriptGenerator.forBlock['tello_wait'] = function(block) {
    const seconds = javascript.javascriptGenerator.valueToCode(block, 'seconds', javascript.javascriptGenerator.ORDER_ATOMIC) || '2';
    return `await executeCommand("wait", { seconds: ${seconds} });\n`;
};


// --- App Logic & Game Handlers ---

// Document Ready Initialization
document.addEventListener("DOMContentLoaded", () => {
    // Initialize Blockly Workspace
    workspace = Blockly.inject('blockly-div', {
        toolbox: document.getElementById('toolbox'),
        scrollbars: true,
        trashcan: true,
        grid: {
            spacing: 25,
            length: 3,
            colour: '#ccc',
            snap: true
        },
        zoom: {
            controls: true,
            wheel: true,
            startScale: 1.1,
            maxScale: 3,
            minScale: 0.3,
            scaleSpeed: 1.2
        }
    });

    // Configure statement highlighting
    javascript.javascriptGenerator.STATEMENT_PREFIX = 'highlightBlock(%1);\n';
    javascript.javascriptGenerator.addReservedWords('highlightBlock');
    javascript.javascriptGenerator.addReservedWords('executeCommand');

    // UI Buttons Events setup
    document.getElementById('btn-run').addEventListener('click', startProgram);
    document.getElementById('btn-stop').addEventListener('click', stopProgram);
    document.getElementById('btn-pause').addEventListener('click', pauseProgram);
    document.getElementById('btn-emergency').addEventListener('click', triggerEmergencyLand);
    document.getElementById('btn-reconnect').addEventListener('click', reconnectTello);
    document.getElementById('btn-clear-workspace').addEventListener('click', clearWorkspace);
    
    // Game Modal controls events
    document.getElementById('btn-player-reset').addEventListener('click', nextPlayerReset);
    document.getElementById('btn-settings-open').addEventListener('click', openSettingsModal);
    document.getElementById('btn-open-signage').addEventListener('click', () => {
        window.open('/ranking', '_blank', 'width=1000,height=800,menubar=no,toolbar=no,status=no');
        closeModal('modal-settings');
    });
    document.getElementById('btn-settings-save').addEventListener('click', saveSettingsModal);
    document.getElementById('btn-register-score').addEventListener('click', openNicknameModal);
    document.getElementById('btn-nickname-submit').addEventListener('click', submitScore);
    document.getElementById('btn-show-ranking').addEventListener('click', openRankingModal);
    document.getElementById('btn-ranking-close').addEventListener('click', () => closeModal('modal-ranking'));
    
    // Modal close spans
    document.getElementById('modal-settings-close').addEventListener('click', () => closeModal('modal-settings'));
    document.getElementById('modal-nickname-close').addEventListener('click', () => closeModal('modal-nickname'));
    document.getElementById('modal-ranking-close').addEventListener('click', () => closeModal('modal-ranking'));

    // Initial Tello Connection and Telemetry update
    reconnectTello();
    startStatusPolling();
    
    addLog("ブロックプログラミングのじゅんびができました！", 'system');
});

// --- Modal Helper Functions ---
function openModal(id) {
    document.getElementById(id).classList.add('active');
}

function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

// Add logs to console (log card is removed from DOM)
function addLog(message, type = 'system') {
    console.log(`[LOG - ${type}] ${message}`);
}

// Clear all blocks in workspace
function clearWorkspaceSilent() {
    if (workspace) {
        workspace.clear();
    }
}

function clearWorkspace() {
    if (confirm("くみたてたブロックを全部消してもいいですか？")) {
        clearWorkspaceSilent();
        addLog("ワークスペースをクリアしました。", 'system');
    }
}

// Status Polling from Flask `/api/status`
function startStatusPolling() {
    if (statusIntervalId) clearInterval(statusIntervalId);
    
    statusIntervalId = setInterval(async () => {
        try {
            const response = await fetch('/api/status');
            if (!response.ok) throw new Error("Status API failed");
            
            const data = await response.json();
            updateTelemetryUI(data);
        } catch (e) {
            console.error("ステータス取得エラー:", e);
            document.getElementById('val-connection').innerText = "せつぞくエラー";
            document.getElementById('status-connection').style.color = 'var(--color-danger)';
        }
    }, 1000);
}

// Update Telemetry elements in the DOM
function updateTelemetryUI(data) {
    // Connection mode
    const connectionText = document.getElementById('val-connection');
    const connectionBox = document.getElementById('status-connection');
    const liveIndicator = document.getElementById('live-indicator');
    
    if (data.connected) {
        if (data.is_mock) {
            connectionText.innerText = "デモモード";
            connectionBox.style.color = 'var(--color-warning)';
            liveIndicator.innerHTML = '<span class="dot" style="background-color: var(--color-warning)"></span>DEMO';
            liveIndicator.style.backgroundColor = '#fef3c7';
            liveIndicator.style.color = 'var(--color-warning)';
        } else {
            connectionText.innerText = "リアルドローン";
            connectionBox.style.color = 'var(--color-success)';
            liveIndicator.innerHTML = '<span class="dot"></span>LIVE';
            liveIndicator.style.backgroundColor = '#fee2e2';
            liveIndicator.style.color = 'var(--color-danger)';
        }
    } else {
        connectionText.innerText = "未接続";
        connectionBox.style.color = 'var(--color-danger)';
        liveIndicator.innerHTML = '<span class="dot" style="background-color: var(--text-muted)"></span>OFFLINE';
        liveIndicator.style.backgroundColor = '#e2e8f0';
        liveIndicator.style.color = 'var(--text-muted)';
    }

    // Battery
    const batteryVal = document.getElementById('val-battery');
    const batteryIcon = document.getElementById('icon-battery');
    const batteryBar = document.getElementById('inner-battery-bar');
    
    batteryVal.innerText = data.battery;
    batteryBar.style.width = `${data.battery}%`;
    
    if (data.battery > 50) {
        batteryIcon.className = 'fa-solid fa-battery-three-quarters';
        batteryIcon.style.color = 'var(--color-success)';
        batteryBar.style.backgroundColor = 'var(--color-success)';
    } else if (data.battery > 20) {
        batteryIcon.className = 'fa-solid fa-battery-quarter';
        batteryIcon.style.color = 'var(--color-warning)';
        batteryBar.style.backgroundColor = 'var(--color-warning)';
    } else {
        batteryIcon.className = 'fa-solid fa-battery-empty';
        batteryIcon.style.color = 'var(--color-danger)';
        batteryBar.style.backgroundColor = 'var(--color-danger)';
    }

    // Altitude, Temp
    const valAltitude = document.getElementById('val-altitude');
    if (valAltitude) valAltitude.innerText = data.altitude;
    const valTemp = document.getElementById('val-temp');
    if (valTemp) valTemp.innerText = data.temperature;

    // Game Mode UI toggles
    const scorePanel = document.getElementById('score-panel');
    if (data.game_mode_enabled) {
        scorePanel.style.display = 'block';
        document.getElementById('val-score').innerText = data.score;
        document.getElementById('val-rank').innerText = data.rank;
        
        // Check for new achievements to trigger Confetti!
        if (data.new_achievements && data.new_achievements.length > 0) {
            data.new_achievements.forEach(item => {
                triggerConfettiCelebrate();
                addLog(`🎉 得点獲得! マーカー ID ${item.id} (+${item.points}てん)`, 'success');
            });
        }
    } else {
        scorePanel.style.display = 'none';
    }
}

// Confetti Popper function
function triggerConfettiCelebrate() {
    // Left shoot
    confetti({
        particleCount: 80,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.8 }
    });
    // Right shoot
    confetti({
        particleCount: 80,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.8 }
    });
}

// Reconnect/init trigger
async function reconnectTello() {
    addLog("Telloにせつぞくしています...", 'system');
    try {
        const response = await fetch('/api/connect', { method: 'POST' });
        const data = await response.json();
        if (data.success) {
            addLog(data.message, 'success');
        } else {
            addLog(`せつぞくできませんでした: ${data.message}`, 'error');
        }
    } catch (e) {
        addLog("サーバーにせつぞくできません。", 'error');
    }
}

// --- Game Settings & Logic Implementations ---

// Open settings overlay
async function openSettingsModal() {
    try {
        const response = await fetch('/api/settings/get');
        const data = await response.json();
        
        document.getElementById('chk-game-mode').checked = data.game_mode_enabled;
        openModal('modal-settings');
    } catch (e) {
        alert("設定の取得に失敗しました。");
    }
}

// Save settings overlay
async function saveSettingsModal() {
    const isGameMode = document.getElementById('chk-game-mode').checked;
    
    try {
        // Fetch current setting first to modify only game mode state
        const configResp = await fetch('/api/settings/get');
        const config = await configResp.json();
        config.game_mode_enabled = isGameMode;
        
        const saveResp = await fetch('/api/settings/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });
        
        const res = await saveResp.json();
        if (res.success) {
            closeModal('modal-settings');
            addLog("ゲームモード設定を更新しました", 'system');
        }
    } catch (e) {
        alert("設定の保存に失敗しました。");
    }
}

// Reset everything for the next pilot (Swap players)
async function nextPlayerReset() {
    if (confirm("点数と組み立てたブロックを消して、次のパイロットと代わりますか？")) {
        try {
            const response = await fetch('/api/game/reset', { method: 'POST' });
            const data = await response.json();
            if (data.success) {
                clearWorkspaceSilent();
                addLog("プレイヤー状態をリセットしました。次の人へどうぞ！", 'success');
            }
        } catch (e) {
            alert("リセット通信に失敗しました。");
        }
    }
}

// Open Nickname score registration modal
function openNicknameModal() {
    document.getElementById('input-nickname').value = '';
    document.getElementById('nickname-error').style.display = 'none';
    openModal('modal-nickname');
}

// Score submission
async function submitScore() {
    const nameInput = document.getElementById('input-nickname').value.trim();
    if (!nameInput) {
        document.getElementById('nickname-error').style.display = 'block';
        return;
    }
    
    try {
        const response = await fetch('/api/game/register_score', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: nameInput })
        });
        const data = await response.json();
        if (data.success) {
            closeModal('modal-nickname');
            clearWorkspaceSilent(); // Reset blocks
            
            // Pop nice full screen confetti for registration completion!
            confetti({
                particleCount: 150,
                spread: 80,
                origin: { y: 0.6 }
            });
            
            // Open ranking board immediately
            openRankingModal();
        }
    } catch (e) {
        alert("得点の登録に失敗しました。");
    }
}

// Fetch and open top rankings modal
async function openRankingModal() {
    try {
        const response = await fetch('/api/game/ranking');
        const data = await response.json();
        
        const listBody = document.getElementById('ranking-list-body');
        listBody.innerHTML = '';
        
        if (data.ranking.length === 0) {
            listBody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-muted);">まだ登録がありません。一番乗りを目指そう！</td></tr>';
        } else {
            // Render ranking rows
            data.ranking.slice(0, 10).forEach((entry, idx) => {
                const rank = idx + 1;
                let rankCell = rank;
                
                // Add crown icon for top 3
                if (rank === 1) rankCell = '<i class="fa-solid fa-crown ranking-rank-1"></i>';
                else if (rank === 2) rankCell = '<i class="fa-solid fa-crown ranking-rank-2"></i>';
                else if (rank === 3) rankCell = '<i class="fa-solid fa-crown ranking-rank-3"></i>';
                
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td class="ranking-rank">${rankCell}</td>
                    <td>${escapeHTML(entry.name)}</td>
                    <td class="ranking-score">${entry.score} 点</td>
                `;
                listBody.appendChild(row);
            });
        }
        
        openModal('modal-ranking');
    } catch (e) {
        alert("ランキングデータの取得に失敗しました。");
    }
}

function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}

// --- Blockly Code Async Execution Engine ---

// Core function called by generated JS blocks
async function executeCommand(action, params = {}) {
    if (shouldStop) {
        throw new Error("PROGRAM_STOPPED");
    }

    let actionLabel = action;
    if (action === 'takeoff') actionLabel = "りりく（とびたつ）";
    else if (action === 'land') actionLabel = "ちゃくりく（おりる）";
    else if (action === 'wait') actionLabel = `${params.seconds}びょう まつ`;
    else if (action === 'move') {
        const dirMap = { forward: 'まえ', back: 'うしろ', left: 'ひだり', right: 'みぎ', up: 'うえ', down: 'した' };
        actionLabel = `${dirMap[params.direction] || params.direction}へ ${params.distance}cm すすむ`;
    } else if (action === 'rotate') {
        const dirMap = { cw: 'みぎまわり', ccw: 'ひだりまわり' };
        actionLabel = `${dirMap[params.direction] || params.direction}に ${params.degree}度 まわる`;
    }

    addLog(`【うごき】${actionLabel} コマンドをおくりました...`, 'command');
    
    try {
        const response = await fetch('/api/command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, params })
        });
        
        if (!response.ok) throw new Error("API通信に失敗しました");
        const data = await response.json();
        
        if (data.success) {
            addLog(`【うごき】${actionLabel} 完了！`, 'success');
            return true;
        } else {
            addLog(`【うごき】${actionLabel} 失敗: ${data.message}`, 'error');
            throw new Error(data.message);
        }
    } catch (e) {
        addLog(`通信エラー: ${e.message}`, 'error');
        throw e;
    }
}

// Highlight Block callback injected inside blocks
function highlightBlock(id) {
    currentHighlightBlockId = id;
    workspace.highlightBlock(id);
}

// Start Program execution
async function startProgram() {
    if (isRunning) return;
    
    workspace.highlightBlock(null);
    shouldStop = false;
    isRunning = true;
    
    document.getElementById('btn-run').disabled = true;
    document.getElementById('btn-stop').disabled = false;
    document.getElementById('btn-pause').disabled = false;
    
    addLog("プログラムを実行します...", 'system');
    
    const code = javascript.javascriptGenerator.workspaceToCode(workspace);
    console.log("Generated Code:\n", code);
    
    if (!code.trim()) {
        addLog("実行するブロックがありません。ブロックをつなげてください。", 'error');
        resetRunState();
        return;
    }
    
    try {
        const runFn = new Function('executeCommand', 'highlightBlock', `
            return (async () => {
                try {
                    ${code}
                } catch(e) {
                    if (e.message !== 'PROGRAM_STOPPED') {
                        throw e;
                    }
                }
            })();
        `);
        
        await runFn(executeCommand, highlightBlock);
        addLog("プログラムがさいごまでおわりました！🎉", 'success');
    } catch (e) {
        if (e.message === 'PROGRAM_STOPPED') {
            addLog("プログラムをとめました。", 'system');
        } else {
            addLog(`実行中にエラーがおきました: ${e.message}`, 'error');
        }
    } finally {
        resetRunState();
    }
}

function pauseProgram() {
    addLog("一時停止は実装されていません。止める場合は「とめる」を押してください。", 'system');
}

function stopProgram() {
    shouldStop = true;
    addLog("プログラムの停止を要求しています...", 'system');
    fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' })
    });
}

function resetRunState() {
    isRunning = false;
    shouldStop = false;
    workspace.highlightBlock(null);
    document.getElementById('btn-run').disabled = false;
    document.getElementById('btn-stop').disabled = true;
    document.getElementById('btn-pause').disabled = true;
}

// Emergency landing cutoff
async function triggerEmergencyLand() {
    shouldStop = true;
    addLog("🚨 緊急ちゃくりくコマンドを送信中！ 🚨", 'error');
    
    try {
        await fetch('/api/command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'land' })
        });
        
        await fetch('/api/command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'emergency' })
        });
        
        addLog("🚨 緊急コマンドを送信しました。ドローンの様子を確認してください。", 'error');
    } catch (e) {
        addLog("🚨 緊急通信に失敗しました！Telloドローンの電源を手動で切るか、十分にご注意ください。", 'error');
    }
    
    resetRunState();
}
