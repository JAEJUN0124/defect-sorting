import { useEffect, useRef } from 'react';

// 카메라 영상 자리. 영상을 받는 방식(MJPEG·스냅샷·웹소켓·WebRTC·이 PC의 USB 카메라)은 기존 camera.js(CameraView)가 맡고,
// 이 부품은 그 자리(stage)만 만들어 준다. stage 안의 요소는 CameraView가 넣고 빼므로 React는 손대지 않는다.
// source: store.cameraSource(id) 또는 null(끔). onView: 만든 CameraView를 위로 알린다 (판정 상자·장면을 넘길 때)
export default function Camera({ source, onView }) {
  const stage = useRef(null);
  const view = useRef(null);

  useEffect(() => {
    const v = new window.CameraView(stage.current, {});
    view.current = v;
    onView(v);
    return () => {
      onView(null);
      v.destroy();
      view.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 같은 영상이면 CameraView가 그대로 둔다 (방식·주소·id가 바뀔 때만 다시 연다)
  useEffect(() => {
    if (view.current) view.current.set(source);
  });

  return <div className="camera__stage" id="camera-stage" ref={stage} />;
}
