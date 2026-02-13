import { useCallback, useState, useEffect } from 'react';
import {
  ReactFlow,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import CompostNode from './nodes/CompostNode';
import AnimatedEdge from './edges/AnimatedEdge';
import NodeDetailPanel from './components/NodeDetailPanel';
import EdgeDetailPanel from './components/EdgeDetailPanel';
import { initialNodes } from './data/nodes';
import { initialEdges } from './data/edges';
import './styles/diagram.css';

// Set to true to unlock dragging and show "Export Positions" button
const EDIT_MODE = true;

const nodeTypes = {
  compostNode: CompostNode,
};

const edgeTypes = {
  animatedEdge: AnimatedEdge,
};

function App() {
  // Load saved positions from localStorage
  const loadNodesWithPositions = () => {
    const saved = localStorage.getItem('compost-positions-v2');
    if (!saved) return initialNodes;

    const positions = JSON.parse(saved);
    return initialNodes.map(node => ({
      ...node,
      position: positions[node.id] || node.position
    }));
  };

  const [nodes, setNodes, onNodesChange] = useNodesState(loadNodesWithPositions());
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedEdge, setSelectedEdge] = useState(null);

  // Handle node click
  const onNodeClick = useCallback((event, node) => {
    setSelectedNode(node);
    setSelectedEdge(null);
  }, []);

  // Handle edge click (passed via data)
  const handleEdgeClick = useCallback((edgeData) => {
    setSelectedEdge(edgeData);
    setSelectedNode(null);
  }, []);

  // Attach edge click handler to all edges
  const edgesWithClickHandler = edges.map(edge => ({
    ...edge,
    data: {
      ...edge.data,
      onEdgeClick: handleEdgeClick
    }
  }));

  // Persist node positions to localStorage
  const onNodesChangeWithPersist = useCallback((changes) => {
    onNodesChange(changes);

    // Save positions on drag end
    const positionChange = changes.find(c => c.type === 'position' && c.dragging === false);
    if (positionChange) {
      // Use setTimeout to ensure state is updated
      setTimeout(() => {
        setNodes(currentNodes => {
          const positions = currentNodes.reduce((acc, node) => {
            acc[node.id] = node.position;
            return acc;
          }, {});
          localStorage.setItem('compost-positions-v2', JSON.stringify(positions));
          return currentNodes;
        });
      }, 0);
    }
  }, [onNodesChange, setNodes]);

  // Close panels when clicking background
  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    setSelectedEdge(null);
  }, []);

  // Close panels with Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setSelectedNode(null);
        setSelectedEdge(null);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <ReactFlow
        nodes={nodes}
        edges={edgesWithClickHandler}
        onNodesChange={onNodesChangeWithPersist}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={EDIT_MODE}
        panOnDrag={EDIT_MODE}
        zoomOnScroll={EDIT_MODE}
        zoomOnPinch={EDIT_MODE}
        zoomOnDoubleClick={EDIT_MODE}
        preventScrolling={!EDIT_MODE}
        fitView
        minZoom={0.5}
        maxZoom={1.5}
      >
      </ReactFlow>

      {EDIT_MODE && (
        <button
          onClick={() => {
            const positions = nodes.reduce((acc, node) => {
              acc[node.id] = { x: Math.round(node.position.x), y: Math.round(node.position.y) };
              return acc;
            }, {});
            const output = Object.entries(positions)
              .map(([id, pos]) => `  '${id}': { x: ${pos.x}, y: ${pos.y} }`)
              .join(',\n');
            const code = `// Paste into nodes.js — update each node's position:\n{\n${output}\n}`;
            console.log(code);
            navigator.clipboard.writeText(code);
            alert('Positions copied to clipboard and logged to console!');
          }}
          style={{
            position: 'fixed',
            bottom: 20,
            right: 20,
            zIndex: 1000,
            padding: '12px 20px',
            background: '#f59e0b',
            color: '#000',
            border: 'none',
            borderRadius: 8,
            fontWeight: 'bold',
            cursor: 'pointer',
            fontSize: 14,
          }}
        >
          Export Positions
        </button>
      )}

      {selectedNode && (
        <NodeDetailPanel
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
        />
      )}

      {selectedEdge && (
        <EdgeDetailPanel
          edge={selectedEdge}
          onClose={() => setSelectedEdge(null)}
        />
      )}
    </div>
  );
}

export default App;
