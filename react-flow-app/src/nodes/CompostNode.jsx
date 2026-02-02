import { Handle, Position } from '@xyflow/react';
import { memo } from 'react';

const categoryColors = {
  input: '#6366f1',      // Indigo - households
  labor: '#f59e0b',      // Amber - collection, cardboard, delivery, food processing
  composting: '#22c55e', // Green - stages 1-4
  processing: '#06b6d4', // Cyan - tea brewing
  output: '#ec4899'      // Pink - purchasers
};

function CompostNode({ data }) {
  return (
    <div
      className="compost-node"
      style={{
        borderColor: categoryColors[data.category],
        backgroundColor: 'rgba(15, 23, 42, 0.9)'
      }}
    >
      {/* Connection handles */}
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: categoryColors[data.category] }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: categoryColors[data.category] }}
      />

      {/* Node content */}
      <div className="node-icon">{data.icon}</div>
      <div className="node-label">{data.label}</div>
      {data.metrics && data.metrics.length > 0 && (
        <div className="node-metric">{data.metrics[0]}</div>
      )}
    </div>
  );
}

export default memo(CompostNode);
