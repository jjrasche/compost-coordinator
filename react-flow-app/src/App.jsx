import { useCallback, useState, useEffect } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
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

const nodeTypes = {
  compostNode: CompostNode,
};

const edgeTypes = {
  animatedEdge: AnimatedEdge,
};

function App() {
  // Load saved positions from localStorage
  const loadNodesWithPositions = () => {
    const saved = localStorage.getItem('compost-positions');
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
          localStorage.setItem('compost-positions', JSON.stringify(positions));
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
        fitView
        minZoom={0.5}
        maxZoom={1.5}
      >
        <Controls />
        <MiniMap
          nodeColor={(node) => {
            const colors = {
              input: '#6366f1',
              labor: '#f59e0b',
              composting: '#22c55e',
              processing: '#06b6d4',
              output: '#ec4899'
            };
            return colors[node.data.category] || '#94a3b8';
          }}
        />
        <Background variant="dots" gap={12} size={1} />
      </ReactFlow>

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
