// 로봇팔 설정 — Brain Us "AI Robot ARM Edu Kit"(SO-ARM101 기반, 모델 AI-Robot-001) 구성에 맞춘 값입니다.
// 근거: 키트 설명서(구성품·전원·안전), LeRobot SO-101 문서·코드(관절 이름·모터 번호·감속비·통신 속도·단위).
// 자세한 설명과 출처는 docs/robot-arm.md
window.HMI_ROBOT = {
  // 서버가 보내는 관절 값의 단위
  //   'auto' = 서버 정보(GET /info)의 joint_unit → 메시지의 unit → 없으면 도(LeRobot 기본값 use_degrees=True)
  //   'deg' = 도 · 'norm' = LeRobot 정규화(-100~100, 그리퍼 0~100) · 'rad' = 라디안 · 'raw' = 서보 원시값(0~4095)
  jointUnit: 'auto',

  // 서버가 보내는 서보 부하의 단위: 'auto'(100을 넘는 값을 보면 그 뒤로 서보 원시값으로 읽음) · 'pct'(%) · 'permille'(원시값, 0.1%)
  loadUnit: 'auto',

  // 퍼센트로 온 관절(LeRobot 그리퍼 0~100 = 캘리브레이션 범위의 비율)을 화면에서 도로 바꿔 보일 때의 범위: [0%일 때 도, 100%일 때 도].
  // 캘리브레이션 범위를 아직 몰라 임의로 정한 값입니다 (사용자 2026-10-17). SO-101 그리퍼는 다 닫힘~다 열림이 대략 100° 안팎이라 0~100°.
  // 범위를 알면 [0, (range_max − range_min) × 360 / 4096]으로 바꿉니다. 적지 않은 관절은 [0, 100]. 원점 복귀 때 서버로 보내는 값은 받은 단위 그대로입니다
  percentToDeg: { gripper: [0, 100] },

  // 관절 순서 = 모터 번호(1~6). LeRobot SO-101 표기
  joints: ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'],

  // 서보 통신: Feetech STS 시리즈 기본값 (LeRobot feetech.py DEFAULT_BAUDRATE, 프로토콜 0, 한 바퀴 4096칸)
  bus: { baudRate: 1000000, resolution: 4096 },

  arms: {
    // 팔로워: 실제로 부품을 집는 팔. 서보 STS3215-C018(12V, 1:345) × 6, 전원 DC 12V 5A
    arm: {
      role: 'follower',
      // 전압 기준 = 어댑터 정격 ±10% (직접 정한 값). 7.5V 어댑터를 잘못 꽂으면 wrongBelow 아래로 내려간다
      supply: { nominal: 12, warnLow: 10.8, warnHigh: 13.2, wrongBelow: 9 },
      motors: {
        shoulder_pan: { id: 1, model: 'STS3215-C018', gear: 345 },
        shoulder_lift: { id: 2, model: 'STS3215-C018', gear: 345 },
        elbow_flex: { id: 3, model: 'STS3215-C018', gear: 345 },
        wrist_flex: { id: 4, model: 'STS3215-C018', gear: 345 },
        wrist_roll: { id: 5, model: 'STS3215-C018', gear: 345 },
        gripper: { id: 6, model: 'STS3215-C018', gear: 345 },
      },
    },
    // 리더: 사람이 손으로 움직이는 팔(수동 모드). 서보 7.4V급, 관절마다 감속비가 다르다(LeRobot SO-101 리더 표와 같음)
    // 전원 DC 7.5V 3A. 12V 어댑터를 잘못 꽂으면 wrongAbove 위로 올라간다 — 7.4V급 서보가 상할 수 있다
    leader: {
      role: 'leader',
      supply: { nominal: 7.5, warnLow: 6.5, warnHigh: 8.4, wrongAbove: 10 },
      motors: {
        shoulder_pan: { id: 1, model: 'STS3215-C044', gear: 191 },
        shoulder_lift: { id: 2, model: 'STS3215-C001', gear: 345 },
        elbow_flex: { id: 3, model: 'STS3215-C044', gear: 191 },
        wrist_flex: { id: 4, model: 'STS3215-C046', gear: 147 },
        wrist_roll: { id: 5, model: 'STS3215-C046', gear: 147 },
        gripper: { id: 6, model: 'STS3215-C046', gear: 147 },
      },
    },
  },

  // 서보 경고 기준. 서보는 70°C(Max_Temperature_Limit 기본값)에 이르면 스스로 힘을 뺀다 — 그 전에 알린다
  limits: { tempWarn: 55, tempAlarm: 65, tempServo: 70, loadWarn: 80 },

  // 서보 상태(telemetry)를 보고 HMI가 직접 경고 기록을 남길지
  //   'auto' = 서버가 servo_* 이벤트를 한 번이라도 보내면 그때부터는 서버 판단만 쓴다 · true · false
  localAlarms: 'auto',

  // 비상정지 안내. 키트 설명서: "비상 정지 — DC 케이블 분리 방법 숙지 후 사용"
  //   'dc-cable' = 화면이 안 들으면 DC 전원 케이블을 뽑으라고 안내 · 'button' = 별도 하드웨어 비상정지 버튼을 달았을 때
  hardwareStop: 'dc-cable',
};
