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
      {/* Connection handles - all four sides */}
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        style={{ background: categoryColors[data.category] }}
      />
      <Handle
        type="target"
        position={Position.Right}
        id="right"
        style={{ background: categoryColors[data.category] }}
      />
      <Handle
        type="target"
        position={Position.Bottom}
        id="bottom"
        style={{ background: categoryColors[data.category] }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        style={{ background: categoryColors[data.category] }}
      />
      <Handle
        type="source"
        position={Position.Top}
        id="top-source"
        style={{ background: categoryColors[data.category] }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right-source"
        style={{ background: categoryColors[data.category] }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom-source"
        style={{ background: categoryColors[data.category] }}
      />
      <Handle
        type="source"
        position={Position.Left}
        id="left-source"
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
