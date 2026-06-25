import os
import time
import cv2
import threading
import json
import numpy as np
from flask import Flask, render_template, jsonify, request, Response, send_file

app = Flask(__name__)

# Game Manager class to handle ArUco settings, rankings, and current player score
class GameManager:
    def __init__(self):
        self.settings_file = "settings.json"
        self.ranking_file = "ranking.json"
        
        # Load settings
        self.game_mode_enabled = False
        self.marker_scores = {
            "0": 10,
            "1": 20,
            "2": 30,
            "3": 50,
            "4": 100
        }
        self.load_settings()
        
        # Current player state
        self.current_score = 0
        self.detected_markers = set()
        self.newly_detected = []
        self.lock = threading.Lock()
        
        # Load ranking
        self.ranking = []
        self.load_ranking()

    def load_settings(self):
        if os.path.exists(self.settings_file):
            try:
                with open(self.settings_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self.game_mode_enabled = data.get("game_mode_enabled", False)
                    # Convert keys to strings for safety
                    self.marker_scores = {str(k): int(v) for k, v in data.get("marker_scores", {}).items()}
            except Exception as e:
                print(f"設定の読み込みに失敗しました: {e}")

    def save_settings(self):
        try:
            with open(self.settings_file, "w", encoding="utf-8") as f:
                json.dump({
                    "game_mode_enabled": self.game_mode_enabled,
                    "marker_scores": self.marker_scores
                }, f, ensure_ascii=False, indent=4)
        except Exception as e:
            print(f"設定の保存に失敗しました: {e}")

    def load_ranking(self):
        if os.path.exists(self.ranking_file):
            try:
                with open(self.ranking_file, "r", encoding="utf-8") as f:
                    self.ranking = json.load(f)
            except Exception as e:
                print(f"ランキングの読み込みに失敗しました: {e}")
                self.ranking = []
        else:
            self.ranking = []

    def save_ranking(self):
        try:
            with open(self.ranking_file, "w", encoding="utf-8") as f:
                json.dump(self.ranking, f, ensure_ascii=False, indent=4)
        except Exception as e:
            print(f"ランキングの保存に失敗しました: {e}")

    def detect_marker(self, marker_id):
        with self.lock:
            # Skip if game mode is off or marker is already detected
            if not self.game_mode_enabled:
                return
            
            str_id = str(marker_id)
            if str_id not in self.detected_markers:
                self.detected_markers.add(str_id)
                points = self.marker_scores.get(str_id, 10) # default 10 pts
                self.current_score += points
                self.newly_detected.append({
                    "id": marker_id,
                    "points": points
                })
                print(f"【得点】マーカー {marker_id} を検出！ +{points}点（合計: {self.current_score}点）")

    def get_newly_detected(self):
        with self.lock:
            temp = list(self.newly_detected)
            self.newly_detected.clear()
            return temp

    def reset_player(self):
        with self.lock:
            self.current_score = 0
            self.detected_markers.clear()
            self.newly_detected.clear()
            print("【ゲーム】プレイヤー状態がリセットされました。")

    def register_score(self, name):
        if not name.strip():
            name = "ななしのパイロット"
        
        with self.lock:
            new_entry = {
                "name": name,
                "score": self.current_score,
                "date": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())
            }
            self.ranking.append(new_entry)
            # Sort by score descending, then date ascending
            self.ranking.sort(key=lambda x: (-x["score"], x["date"]))
            # Keep top 100
            self.ranking = self.ranking[:100]
            self.save_ranking()
            score_registered = self.current_score
            self.reset_player()
            return score_registered

    def get_rank(self):
        # Calculate current rank based on ranking list + current score
        if self.current_score == 0:
            return len(self.ranking) + 1
        
        rank = 1
        for entry in self.ranking:
            if entry["score"] > self.current_score:
                rank += 1
        return rank

game_manager = GameManager()

# Tello controller class to handle connection, commands, and telemetry
class TelloController:
    def __init__(self):
        self.tello = None
        self.is_connected = False
        self.is_mock = True  # Defaults to Mock mode until connected to real Tello
        self.battery = 100
        self.temperature = 25
        self.altitude = 0
        self.flight_time = 0
        self.status_thread = None
        self.frame_read = None
        self.lock = threading.Lock()
        
        # Setup OpenCV ArUco Detector
        try:
            self.aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
            self.detector_params = cv2.aruco.DetectorParameters()
            self.aruco_detector = cv2.aruco.ArucoDetector(self.aruco_dict, self.detector_params)
        except Exception as e:
            print(f"ArUcoディテクタ初期化失敗 (古いOpenCVの可能性があります): {e}")
            self.aruco_detector = None

    def connect(self):
        with self.lock:
            try:
                from djitellopy import Tello as DJITello
                print("Telloドローンへの接続を試みています...")
                self.tello = DJITello()
                self.tello.connect()
                self.is_connected = True
                self.is_mock = False
                
                # Turn on video stream
                try:
                    self.tello.streamon()
                    self.frame_read = self.tello.get_frame_read()
                except Exception as e:
                    print(f"ビデオストリームの有効化に失敗しました: {e}")
                
                # Start telemetry loop
                if not self.status_thread or not self.status_thread.is_alive():
                    self.status_thread = threading.Thread(target=self._update_status_loop, daemon=True)
                    self.status_thread.start()
                
                return True, "Telloドローンに接続しました！"
            except Exception as e:
                print(f"Tello実機への接続に失敗しました。シミュレーションモードで開始します: {e}")
                self.is_connected = True
                self.is_mock = True
                self.battery = 100
                self.temperature = 28
                self.altitude = 0
                self.flight_time = 0
                
                # Start telemetry simulation loop
                if not self.status_thread or not self.status_thread.is_alive():
                    self.status_thread = threading.Thread(target=self._update_status_loop, daemon=True)
                    self.status_thread.start()
                
                return True, "Telloが見つかりません。シミュレーション(デモ)モードで開始します。"

    def _update_status_loop(self):
        while self.is_connected:
            try:
                if not self.is_mock and self.tello:
                    self.battery = self.tello.get_battery()
                    self.temperature = self.tello.get_highest_temperature()
                    self.altitude = self.tello.get_distance_tof()
                    self.flight_time = self.tello.get_flight_time()
                else:
                    # Simulating minor battery drain or sensor shifts
                    if self.altitude > 0:
                        self.flight_time += 1
                        if self.flight_time % 10 == 0:
                            self.battery = max(10, self.battery - 1)
                        # Add a tiny sensor jitter for realistic display
                        jitter = np.random.randint(-1, 2)
                        self.altitude = max(50, self.altitude + jitter)
                time.sleep(1)
            except Exception as e:
                print(f"ステータス更新ループエラー: {e}")
                time.sleep(2)

    def disconnect(self):
        with self.lock:
            self.is_connected = False
            if not self.is_mock and self.tello:
                try:
                    self.tello.streamoff()
                    self.tello.end()
                except Exception as e:
                    print(f"切断エラー: {e}")
            self.tello = None
            self.frame_read = None

    def send_command(self, action, params=None):
        if not self.is_connected:
            return False, "ドローンが接続されていません"
        
        if params is None:
            params = {}
            
        print(f"コマンド受信: action={action}, params={params}")
        
        if self.is_mock:
            # Simulator mode execution logic
            time.sleep(0.8) # Simulate processing/execution latency
            if action == 'takeoff':
                if self.altitude > 0:
                    return False, "すでに離陸しています"
                self.altitude = 100 # 100cm (1m)
                self.flight_time = 0
            elif action == 'land':
                if self.altitude == 0:
                    return False, "すでに着陸しています"
                self.altitude = 0
            elif action == 'move':
                direction = params.get('direction')
                distance = int(params.get('distance', 20))
                if direction == 'up':
                    self.altitude += distance
                elif direction == 'down':
                    self.altitude = max(0, self.altitude - distance)
                self.battery = max(1, self.battery - 1)
            elif action == 'rotate':
                self.battery = max(1, self.battery - 1)
            elif action == 'wait':
                seconds = float(params.get('seconds', 1.0))
                time.sleep(seconds)
            elif action == 'stop':
                pass
            return True, f"【シミュレータ】{action} コマンドを完了しました"
        
        # Real Tello Command Execution
        try:
            if action == 'takeoff':
                self.tello.takeoff()
            elif action == 'land':
                self.tello.land()
            elif action == 'move':
                direction = params.get('direction')
                distance = int(params.get('distance', 20))
                distance = max(20, min(500, distance)) # Tello limits (20cm to 500cm)
                
                if direction == 'forward':
                    self.tello.move_forward(distance)
                elif direction == 'back':
                    self.tello.move_back(distance)
                elif direction == 'left':
                    self.tello.move_left(distance)
                elif direction == 'right':
                    self.tello.move_right(distance)
                elif direction == 'up':
                    self.tello.move_up(distance)
                elif direction == 'down':
                    self.tello.move_down(distance)
            elif action == 'rotate':
                direction = params.get('direction') # 'cw' (clockwise) or 'ccw'
                degree = int(params.get('degree', 90))
                degree = max(1, min(360, degree))
                
                if direction == 'cw':
                    self.tello.rotate_clockwise(degree)
                elif direction == 'ccw':
                    self.tello.rotate_counter_clockwise(degree)
            elif action == 'wait':
                seconds = float(params.get('seconds', 1.0))
                time.sleep(seconds)
            elif action == 'stop':
                self.tello.send_rc_control(0, 0, 0, 0)
            elif action == 'emergency':
                self.tello.emergency()
                self.altitude = 0
                
            return True, f"{action} コマンドを完了しました"
        except Exception as e:
            return False, f"Telloコマンド失敗: {str(e)}"

    def get_frame(self):
        frame = None
        if not self.is_mock and self.frame_read:
            try:
                frame_raw = self.frame_read.frame
                # djitellopy returns RGB, OpenCV needs BGR
                frame = cv2.cvtColor(frame_raw, cv2.COLOR_RGB2BGR)
            except Exception as e:
                print(f"フレーム取得エラー: {e}")
        
        # Fallback to pop-looking simulated frame
        if frame is None:
            frame = np.zeros((480, 640, 3), dtype=np.uint8)
            
            # Pop blueish gradient background
            for y in range(480):
                ratio = y / 480.0
                r = int(26 * (1 - ratio) + 14 * ratio)
                g = int(36 * (1 - ratio) + 20 * ratio)
                b = int(67 * (1 - ratio) + 40 * ratio)
                frame[y, :] = [b, g, r]
                
            # Draw grid cockpit vibe
            for x in range(0, 640, 80):
                cv2.line(frame, (x, 0), (x, 480), (80, 70, 50), 1)
            for y in range(0, 480, 80):
                cv2.line(frame, (0, y), (640, y), (80, 70, 50), 1)
                
            # Draw Tello-like drone silhouette in center
            center_x, center_y = 320, 240
            cv2.line(frame, (center_x - 120, center_y - 60), (center_x + 120, center_y + 60), (120, 120, 120), 4)
            cv2.line(frame, (center_x - 120, center_y + 60), (center_x + 120, center_y - 60), (120, 120, 120), 4)
            
            rot_color = (0, 200, 255) if self.altitude > 0 else (150, 150, 150)
            angle = int(time.time() * 500) if self.altitude > 0 else 0
            
            for rx, ry in [(-120, -60), (120, -60), (-120, 60), (120, 60)]:
                cv2.circle(frame, (center_x + rx, center_y + ry), 30, rot_color, 2)
                rad = np.deg2rad(angle)
                bx = int(30 * np.cos(rad))
                by = int(30 * np.sin(rad))
                cv2.line(frame, (center_x + rx - bx, center_y + ry - by), (center_x + rx + bx, center_y + ry + by), rot_color, 1)
                
            cv2.ellipse(frame, (center_x, center_y), (60, 40), 0, 0, 360, (240, 240, 240), -1)
            cv2.ellipse(frame, (center_x, center_y), (60, 40), 0, 0, 360, (180, 180, 180), 2)
            cv2.circle(frame, (center_x, center_y + 20), 12, (50, 50, 50), -1)
            cv2.circle(frame, (center_x, center_y + 20), 5, (0, 255, 0), -1)
            
            # Simulator Text overlay
            cv2.putText(frame, "PROGRAMMING GAME SIMULATOR", (20, 40), cv2.FONT_HERSHEY_DUPLEX, 0.7, (255, 255, 255), 1, cv2.LINE_AA)
            
            mode_str = "DEMO (SIMULATOR)" if self.is_mock else "REAL DRONE"
            badge_color = (0, 165, 255) if self.is_mock else (0, 220, 0)
            cv2.rectangle(frame, (20, 60), (220, 90), badge_color, -1)
            cv2.putText(frame, mode_str, (30, 82), cv2.FONT_HERSHEY_DUPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
            
            # Telemetry text blocks
            cv2.putText(frame, f"BATTERY  : {self.battery}%", (20, 130), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0) if self.battery > 30 else (0, 0, 255), 1, cv2.LINE_AA)
            cv2.putText(frame, f"ALTITUDE : {self.altitude} cm", (20, 160), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
            cv2.putText(frame, f"TEMP     : {self.temperature} C", (20, 190), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
            cv2.putText(frame, f"TIME     : {self.flight_time} s", (20, 220), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
            
            cv2.drawMarker(frame, (center_x, center_y), (0, 255, 0), cv2.MARKER_CROSS, 20, 1)

            if self.altitude > 0:
                cv2.putText(frame, "[HOVERING]", (500, 40), cv2.FONT_HERSHEY_DUPLEX, 0.6, (0, 255, 0), 1, cv2.LINE_AA)
            else:
                cv2.putText(frame, "[LANDED]", (510, 40), cv2.FONT_HERSHEY_DUPLEX, 0.6, (170, 170, 170), 1, cv2.LINE_AA)

            timestamp = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())
            cv2.putText(frame, timestamp, (20, 450), cv2.FONT_HERSHEY_DUPLEX, 0.5, (180, 180, 180), 1, cv2.LINE_AA)

            # In Demo mode, simulate finding an ArUco marker periodically if flying
            if game_manager.game_mode_enabled and self.altitude > 0:
                # Every ~10 seconds, mock detecting a random marker from ID 0 to 4
                sim_sec = int(time.time()) % 12
                if sim_sec == 5:
                    mock_id = (int(time.time()) // 12) % 5
                    game_manager.detect_marker(mock_id)
                    
                    # Draw a mock marker bounding box in top right for visual demo feedback
                    cv2.rectangle(frame, (450, 80), (550, 180), (0, 255, 0), 2)
                    cv2.putText(frame, f"ID: {mock_id}", (450, 75), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)

        # Real-time ArUco detection on actual camera frame or simulated frame
        if game_manager.game_mode_enabled and self.aruco_detector is not None:
            try:
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                corners, ids, rejected = self.aruco_detector.detectMarkers(gray)
                if ids is not None:
                    # Draw borders and ID numbers on the screen
                    cv2.aruco.drawDetectedMarkers(frame, corners, ids)
                    for marker_id in ids.flatten():
                        game_manager.detect_marker(int(marker_id))
            except Exception as e:
                # Silently catch frame structure mismatches if any
                pass

        return frame

controller = TelloController()

# Flask Routes
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/settings')
def settings_page():
    return render_template('settings.html')

@app.route('/ranking')
def ranking_page():
    return render_template('ranking.html')

@app.route('/api/connect', methods=['POST'])
def api_connect():
    success, message = controller.connect()
    return jsonify({
        "success": success,
        "message": message,
        "is_mock": controller.is_mock
    })

@app.route('/api/status', methods=['GET'])
def api_status():
    new_achievements = game_manager.get_newly_detected()
    return jsonify({
        "connected": controller.is_connected,
        "is_mock": controller.is_mock,
        "battery": controller.battery,
        "temperature": controller.temperature,
        "altitude": controller.altitude,
        "flight_time": controller.flight_time,
        
        # Game states
        "game_mode_enabled": game_manager.game_mode_enabled,
        "score": game_manager.current_score,
        "rank": game_manager.get_rank(),
        "new_achievements": new_achievements,
        "detected_markers": list(game_manager.detected_markers)
    })

@app.route('/api/command', methods=['POST'])
def api_command():
    data = request.json or {}
    action = data.get('action')
    params = data.get('params', {})
    
    if not action:
        return jsonify({"success": False, "message": "アクションが指定されていません"}), 400
        
    success, message = controller.send_command(action, params)
    return jsonify({
        "success": success,
        "message": message
    })

# Game settings APIs
@app.route('/api/settings/get', methods=['GET'])
def api_get_settings():
    return jsonify({
        "game_mode_enabled": game_manager.game_mode_enabled,
        "marker_scores": game_manager.marker_scores
    })

@app.route('/api/settings/save', methods=['POST'])
def api_save_settings():
    data = request.json or {}
    game_manager.game_mode_enabled = bool(data.get("game_mode_enabled", False))
    
    # Save score mapping
    scores = data.get("marker_scores", {})
    game_manager.marker_scores = {str(k): int(v) for k, v in scores.items()}
    game_manager.save_settings()
    
    return jsonify({"success": True, "message": "設定を保存しました"})

@app.route('/api/game/reset', methods=['POST'])
def api_game_reset():
    game_manager.reset_player()
    return jsonify({"success": True, "message": "得点と獲得マーカーをリセットしました"})

@app.route('/api/game/register_score', methods=['POST'])
def api_register_score():
    data = request.json or {}
    name = data.get("name", "").strip()
    score_registered = game_manager.register_score(name)
    return jsonify({
        "success": True, 
        "message": f"得点 {score_registered} 点を登録しました！",
        "registered_score": score_registered
    })

@app.route('/api/game/ranking', methods=['GET'])
def api_get_ranking():
    return jsonify({
        "ranking": game_manager.ranking
    })

# AR Marker generator image server (for print view)
@app.route('/api/game/marker/<int:marker_id>')
def get_marker_image(marker_id):
    try:
        # Generate raw 4x4 ArUco marker
        aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
        # 300x300 pixels
        marker_img = cv2.aruco.generateImageMarker(aruco_dict, marker_id, 300, borderBits=1)
        
        # Add a nice white safety border around the marker image so camera decodes it correctly
        border_size = 40
        bordered_img = cv2.copyMakeBorder(
            marker_img, border_size, border_size, border_size, border_size, 
            cv2.BORDER_CONSTANT, value=255
        )
        
        # Encode to PNG bytes
        ret, buf = cv2.imencode('.png', bordered_img)
        if not ret:
            return "マーカー画像のエンコードに失敗しました", 500
        
        # Cache image temporarily in memory
        from io import BytesIO
        img_io = BytesIO(buf.tobytes())
        return send_file(img_io, mimetype='image/png', download_name=f'aruco_{marker_id}.png')
    except Exception as e:
        return f"マーカー画像生成エラー: {str(e)}", 500

# Streaming frame generator
def gen_video():
    while True:
        frame = controller.get_frame()
        ret, jpeg = cv2.imencode('.jpg', frame)
        if not ret:
            continue
        frame_bytes = jpeg.tobytes()
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
        time.sleep(0.04) # 25 FPS

@app.route('/video_feed')
def video_feed():
    return Response(gen_video(), mimetype='multipart/x-mixed-replace; boundary=frame')

if __name__ == '__main__':
    # Start Tello connection in a background thread
    threading.Thread(target=controller.connect, daemon=True).start()
    app.run(host='0.0.0.0', port=5000, debug=True, use_reloader=False)
