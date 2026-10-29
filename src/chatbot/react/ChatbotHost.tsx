import { useRef } from 'react';
import { useChatWidget } from '@/chatbot/react/useChatWidget';
import { PlotModal } from '@/chatbot/react/PlotModal';

export function ChatbotHost() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { activePlot, setActivePlot, downloadPlotPdf, pdfBusy } = useChatWidget(containerRef, { inline: false });
  return (
    <>
      <div ref={containerRef} />
      <PlotModal plot={activePlot} onClose={() => setActivePlot(null)} onDownload={downloadPlotPdf} busy={pdfBusy} />
    </>
  );
}