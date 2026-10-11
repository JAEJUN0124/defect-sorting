// 화면 문구 — 한국어
// 영어를 추가할 때는 이 파일을 복사해 en.js를 만들고, 같은 키에 영어 문장을 넣은 뒤
// index.html에서 불러오고 config.js의 locale을 'en'으로 바꾸면 됩니다.
window.HMI_I18N = window.HMI_I18N || {};
window.HMI_I18N.ko = {
  'app.title': '불량 선별 HMI',
  'panel.label': '조작반',

  // 라인 상태
  'state.connecting': '연결 중',
  'state.offline': '연결 끊김',
  'state.stopped': '정지',
  'state.starting': '시작 중',
  'state.running': '가동 중',
  'state.stopping': '정지 중',
  'state.homing': '원점 이동 중',
  'state.estop': '긴급정지',
  'state.shutdown': '종료 중',

  'detail.connecting': '서버에 연결하고 있습니다.',
  'detail.offline': '서버에 다시 연결하고 있습니다. 그동안 화면 조작은 잠깁니다.',
  'detail.stopped.auto': '시작을 누르면 자동 선별을 시작합니다.',
  'detail.stopped.manual': '시작을 누르면 리더암으로 로봇팔을 움직일 수 있습니다.',
  'detail.starting': '장치 연결을 확인하고 있습니다.',
  'detail.running.auto': '카메라 판정에 따라 로봇팔이 불량품을 골라냅니다.',
  'detail.running.manual': '로봇팔이 리더암의 움직임을 따라 움직입니다.',
  'detail.stopping': '컨베이어와 로봇팔을 멈추고 있습니다.',
  'detail.homing': '로봇팔 6축을 원점 각도로 옮기고 있습니다.',
  'detail.estop': '모든 조작이 잠겼습니다. 주변 안전을 확인한 뒤 해제하세요.',
  'detail.shutdown': '라인을 멈추고 장치 연결을 정리하고 있습니다.',

  // 긴급정지
  'estop.press': '긴급정지',
  'estop.latched': '긴급정지 중',
  'estop.release': '긴급정지 해제',
  'estop.offline': '서버에 연결되지 않아 화면 긴급정지를 보낼 수 없습니다. 장비의 비상정지 버튼을 누르세요.',

  // 시작 / 정지
  'run.start': '시작',
  'run.stop': '정지',
  'run.locked': '원점 잡기와 모드 전환은 정지한 뒤 할 수 있습니다.',

  // 원점
  'home.label': '원점 잡기',
  'home.provisional': '원점 각도가 아직 임시값입니다. config/home-position.js를 채우세요.',

  // 모드
  'mode.legend': '운전 모드',
  'mode.auto': '자동',
  'mode.manual': '수동',

  // 리더암 관절
  'joints.title': '리더암 각도',
  'joint.shoulder_pan': '어깨 회전',
  'joint.shoulder_lift': '어깨 들기',
  'joint.elbow_flex': '팔꿈치',
  'joint.wrist_flex': '손목 굽힘',
  'joint.wrist_roll': '손목 회전',
  'joint.gripper': '그리퍼',

  // 종료
  'exit.label': '프로그램 종료',

  // 카메라
  'camera.label': '카메라 영상',
  'camera.off': '카메라가 꺼져 있습니다',
  'camera.connect': '카메라 연결',
  'camera.connecting': '연결 중',
  'camera.disconnect': '카메라 끄기',

  // 판정
  'result.good': '양품',
  'result.defect': '불량',

  // 통계
  'stats.label': '생산 통계',
  'stats.total': '검사',
  'stats.good': '양품',
  'stats.defect': '불량',
  'stats.rate': '불량률',

  // 테마
  'theme.dark': '다크 모드',

  // 로그
  'log.open': '로그',
  'log.title': '로그',
  'log.close': '닫기',
  'log.unread': '확인하지 않은 경고가 있습니다',
  'log.empty': '아직 기록이 없습니다. 라인을 시작하면 여기에 쌓입니다.',

  // 장치
  'devices.title': '장치 연결 (개발용)',
  'devices.toggleHint': '눌러서 연결 끊김을 흉내 냅니다 (가짜 서버 전용)',
  'devices.disconnected': '끊김',
  'device.server': '서버',
  'device.conveyor': '컨베이어',
  'device.arm': '로봇팔',
  'device.leader': '리더암',
  'device.camera': '카메라',

  // 서버 이벤트 코드 (docs/API.md 4.1)
  'event.line_started': '라인을 시작했습니다',
  'event.line_stopped': '라인을 정지했습니다',
  'event.line_stopped_fault': '{device} 연결이 끊겨 라인을 정지했습니다',
  'event.start_rejected': '{devices} 연결이 끊겨 시작하지 못했습니다',
  'event.estop_pressed': '긴급정지',
  'event.estop_released': '긴급정지를 해제했습니다',
  'event.home_started': '원점으로 이동을 시작했습니다',
  'event.home_completed': '원점 이동을 마쳤습니다',
  'event.mode_changed': '{mode} 모드로 바꿨습니다',
  'event.defect_detected': '불량품을 찾았습니다 (#{id})',
  'event.device_disconnected': '{device} 연결이 끊겼습니다',
  'event.device_reconnected': '{device}에 다시 연결했습니다',
  'event.camera_started': '카메라를 연결했습니다',
  'event.camera_stopped': '카메라를 껐습니다',
  'event.shutdown_started': '프로그램 종료를 시작했습니다',
  'event.server_lost': '서버 연결이 끊겼습니다',
  'event.server_back': '서버에 다시 연결했습니다',

  // 오류 (명령 실패)
  'error.DEVICES_NOT_READY': '{devices} 연결이 끊겨 있어 실행하지 못했습니다. 연결을 확인한 뒤 다시 누르세요.',
  'error.ESTOP_ACTIVE': '긴급정지 중이라 실행하지 못했습니다. 긴급정지를 해제한 뒤 다시 누르세요.',
  'error.NOT_STOPPED': '라인이 움직이는 중이라 실행하지 못했습니다. 정지한 뒤 다시 누르세요.',
  'error.INVALID_ANGLES': '원점 각도 설정이 잘못되어 이동하지 못했습니다. config/home-position.js를 확인하세요.',
  'error.NETWORK': '서버에 명령이 닿지 않았습니다. 서버 연결을 확인한 뒤 다시 누르세요.',
  'error.unknown': '명령을 처리하지 못했습니다 ({code}). 잠시 뒤 다시 누르세요.',

  // 확인 창
  'dialog.cancel': '취소',
  'dialog.release.title': '긴급정지를 해제할까요?',
  'dialog.release.body': '해제해도 라인은 정지 상태로 남습니다. 다시 가동하려면 시작을 누르세요.',
  'dialog.release.confirm': '긴급정지 해제',
  'dialog.exit.title': '프로그램을 종료할까요?',
  'dialog.exit.body': '라인을 멈추고 장치 연결을 정리한 뒤 HMI를 닫습니다.',
  'dialog.exit.confirm': '프로그램 종료',

  'ended.title': 'HMI를 종료했습니다',
  'ended.body': '이 창을 닫아도 됩니다.',
};
