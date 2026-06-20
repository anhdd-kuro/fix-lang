import React from "react";
import { Button } from "./Button";
import CopyButton from "./CopyButton";
import { Dialog } from "./Dialog";
import { TextArea } from "./TextArea";

type HistoryReviewModalProps = {
  isOpen: boolean;
  data: { original: string; corrected: string; modelId?: string };
  onClose: () => void;
};

/**
 * History review modal — dark-native sheet showing a correction diff.
 * Uses Dialog + TextArea + Button primitives; no literal color classes.
 */
const HistoryReviewModal: React.FC<HistoryReviewModalProps> = ({
  isOpen,
  data,
  onClose,
}) => {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={
        <span className="flex items-center gap-3">
          Last Correction
          {data.modelId && (
            <span className="text-[0.769rem] font-normal text-label-secondary">
              {data.modelId}
            </span>
          )}
        </span>
      }
      widthClassName="w-2/3 max-w-2xl"
      maxHeightClassName="max-h-[90vh]"
      footer={
        <Button variant="prominent" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="flex flex-col md:flex-row gap-4">
        <TextArea
          label="Original"
          value={data.original}
          readOnly
          rows={8}
          className="flex-1"
          aria-label="Original text"
          headerAction={
            <CopyButton value={data.original} label="Copy original" />
          }
        />
        <TextArea
          label="Corrected"
          value={data.corrected}
          readOnly
          rows={8}
          className="flex-1"
          aria-label="Corrected text"
          headerAction={
            <CopyButton value={data.corrected} label="Copy corrected" />
          }
        />
      </div>
    </Dialog>
  );
};

export default HistoryReviewModal;
