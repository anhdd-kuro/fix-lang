import React from "react";
import CopyButton from "./CopyButton";

type HistoryReviewModalProps = {
  isOpen: boolean;
  data: { original: string; corrected: string };
  onClose: () => void;
};

const HistoryReviewModal: React.FC<HistoryReviewModalProps> = ({
  isOpen,
  data,
  onClose,
}) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/60 flex justify-center items-center z-50">
      <div className="bg-gray-800 rounded-lg shadow-xl p-6 w-2/3 max-w-2xl max-h-[90vh] overflow-auto">
        <h2 className="text-xl text-gray-200 mb-4">Last Correction</h2>
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 flex flex-col">
            <h3 className="text-lg text-gray-300 mb-2">Original</h3>
            <CopyButton
              value={data.original}
              label="Copy original"
              className="self-end mb-2"
            />
            <textarea
              readOnly
              value={data.original}
              className="w-full h-48 bg-gray-700 text-gray-100 p-2 rounded-md resize-none"
              aria-label="Original text"
            />
          </div>
          <div className="flex-1 flex flex-col">
            <h3 className="text-lg text-gray-300 mb-2">Corrected</h3>
            <CopyButton
              value={data.corrected}
              label="Copy corrected"
              className="self-end mb-2"
            />
            <textarea
              readOnly
              value={data.corrected}
              className="w-full h-48 bg-gray-700 text-gray-100 p-2 rounded-md resize-none"
              aria-label="Corrected text"
            />
          </div>
        </div>
        <div className="mt-4 text-right">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500"
            aria-label="Close review modal"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default HistoryReviewModal;
