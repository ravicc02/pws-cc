import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, ImagePlus, Mic, Square, Send, X, Forward } from 'lucide-react';

function readData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('无法读取附件。'));
    reader.readAsDataURL(file);
  });
}

export default function ChatWorkspace({ request, onOpen, onModel }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [needsModel, setNeedsModel] = useState(false);
  const [image, setImage] = useState(null);
  const [audio, setAudio] = useState(null);
  const [recording, setRecording] = useState(false);
  const recorder = useRef(null);
  const imagePicker = useRef(null);
  const audioPicker = useRef(null);
  const bottom = useRef(null);
  useEffect(() => { request('/chat').then((result) => setMessages(result.messages)).catch((cause) => setError(cause.message)); }, []);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages]);

  async function attach(file, kind) {
    if (!file) return;
    const allowed = kind === 'image' ? ['image/jpeg', 'image/png', 'image/webp'] : ['audio/wav', 'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg'];
    const limit = kind === 'image' ? 6 : 12;
    if (!allowed.includes(file.type) || file.size > limit * 1024 * 1024) { setError(`仅支持 ${allowed.join('、')}，不超过 ${limit} MB。`); return; }
    setError('');
    if (kind === 'image') setImage(file);
    else setAudio(file);
  }

  async function toggleRecording() {
    if (recorder.current?.state === 'recording') { recorder.current.stop(); setRecording(false); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ['audio/webm', 'audio/ogg'].find((mime) => MediaRecorder.isTypeSupported(mime));
      if (!mimeType) { stream.getTracks().forEach((track) => track.stop()); throw new Error('浏览器不支持录音格式。'); }
      const chunks = [];
      const next = new MediaRecorder(stream, { mimeType });
      next.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      next.onstop = () => { stream.getTracks().forEach((track) => track.stop()); setAudio(new File(chunks, `voice.${mimeType.split('/')[1]}`, { type: mimeType })); };
      next.start(); recorder.current = next; setRecording(true);
    } catch (cause) { setError(cause.message || '无法访问麦克风。'); }
  }

  async function send(event) {
    event.preventDefault();
    if ((!text.trim() && !image && !audio) || busy) return;
    const value = text.trim();
    setError('');
    setBusy(true);
    setMessages((current) => [...current, { role: 'user', text: value || (image ? '[图片]' : '[语音]'), ...(image ? { preview: URL.createObjectURL(image) } : {}) }]);
    try {
      const result = await request('/chat', { method: 'POST', body: JSON.stringify({ text: value, ...(image ? { image: await readData(image) } : {}), ...(audio ? { audio: await readData(audio) } : {}) }) });
      setMessages(result.messages);
      setText(''); setImage(null); setAudio(null);
      setNeedsModel(false);
    } catch (cause) {
      setMessages((current) => current.slice(0, -1));
      setError(cause.message);
      setNeedsModel(cause.message.includes('模型配置'));
    } finally { setBusy(false); }
  }

  return <div className="chat-view">
    <div className="chat-messages" aria-live="polite">
      {messages.length === 0 && <div className="chat-empty"><h2>今天想记录什么？</h2><p>可以说“今天卧推 100kg”，也可以询问已有的记录。</p></div>}
      {messages.map((message, index) => <div key={index} className={`chat-message ${message.role}`}><div className="chat-bubble">{message.imageId && <img className="chat-image" src={`/api/media/${message.imageId}`} alt="对话图片" />}{message.preview && <img className="chat-image" src={message.preview} alt="正在发送的图片" />}{message.text}</div>{message.role === 'user' && message.imageId && <button className="chat-forward" title="把图片发送到绑定的微信" onClick={async () => { try { await request('/weixin/send-image', { method: 'POST', body: JSON.stringify({ imageId: message.imageId }) }); setError('微信接口已接受图片，请在手机确认是否收到。'); } catch (cause) { setError(cause.message); } }}><Forward size={14} /> 发到微信</button>}{message.written?.length > 0 && <div className="chat-writes">{message.written.map((item, i) => <button key={i} onClick={() => onOpen(item)}>{item.kind === 'profile' ? '查看长期目标' : `查看 ${item.date} 记录`} <ArrowRight size={14} /></button>)}</div>}</div>)}
      <div ref={bottom} />
    </div>
    {error && <div className="chat-error" role="alert">{error}{needsModel && <button onClick={onModel}>前往模型配置 <ArrowRight size={14} /></button>}</div>}
    <form className="chat-compose" onSubmit={send}>
      <input ref={imagePicker} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { attach(event.target.files?.[0], 'image'); event.target.value = ''; }} />
      <input ref={audioPicker} className="visually-hidden" type="file" accept="audio/wav,audio/webm,audio/ogg,audio/mp4,audio/mpeg" onChange={(event) => { attach(event.target.files?.[0], 'audio'); event.target.value = ''; }} />
      <div className="chat-tools"><button type="button" title="添加图片" aria-label="添加图片" onClick={() => imagePicker.current?.click()}><ImagePlus size={18} /></button><button type="button" title={recording ? '结束录音' : '录制语音'} aria-label={recording ? '结束录音' : '录制语音'} onClick={toggleRecording}>{recording ? <Square size={17} /> : <Mic size={18} />}</button><button type="button" className="chat-audio-file" onClick={() => audioPicker.current?.click()}>上传音频</button></div>
      <div className="chat-input"><textarea aria-label="对话输入" placeholder="说说今天发生了什么…" value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />{(image || audio) && <div className="chat-attachment">{image?.name || audio?.name}<button type="button" title="移除附件" aria-label="移除附件" onClick={() => { setImage(null); setAudio(null); }}><X size={14} /></button></div>}</div>
      <button className="primary-button" type="submit" disabled={busy || recording || (!text.trim() && !image && !audio)} aria-label="发送消息" title="发送消息"><Send size={17} /></button>
    </form>
    <p className="chat-privacy">消息与相关记录会发送到你配置的模型服务。写入的记录可在资料页修改。</p>
  </div>;
}
