import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react';
import { memo } from 'react';

function AnimatedEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  data
}) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const {
    icons = [],
    bidirectional = false,
    reverseIcons = [],
    animationDuration = 2
  } = data || {};

  return (
    <>
      {/* Main edge path with animated dashed line */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          strokeDasharray: '8 4',
          animation: `flow ${animationDuration}s linear infinite`
        }}
      />

      {/* Forward direction icons */}
      {icons.map((icon, index) => {
        const offset = (index / icons.length) * animationDuration;
        return (
          <g key={`forward-${index}`}>
            <text
              fontSize="1.2rem"
              textAnchor="middle"
              dominantBaseline="middle"
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              <animateMotion
                dur={`${animationDuration}s`}
                repeatCount="indefinite"
                begin={`${offset}s`}
              >
                <mpath href={`#${id}`} />
              </animateMotion>
              {icon}
            </text>
          </g>
        );
      })}

      {/* Reverse direction icons (if bidirectional) */}
      {bidirectional && reverseIcons.map((icon, index) => {
        const offset = (index / reverseIcons.length) * animationDuration;
        return (
          <g key={`reverse-${index}`}>
            <text
              fontSize="1.2rem"
              textAnchor="middle"
              dominantBaseline="middle"
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              <animateMotion
                dur={`${animationDuration}s`}
                repeatCount="indefinite"
                begin={`${offset}s`}
                keyPoints="1;0"  // Reverse direction
                keyTimes="0;1"
              >
                <mpath href={`#${id}`} />
              </animateMotion>
              {icon}
            </text>
          </g>
        );
      })}

      {/* Clickable edge label for interactions */}
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="edge-label-clickable"
        >
          {/* Invisible clickable area */}
          <button
            onClick={() => data.onEdgeClick?.(data)}
            style={{
              width: 40,
              height: 40,
              opacity: 0,
              cursor: 'pointer',
              border: 'none',
              background: 'transparent'
            }}
            aria-label="View edge details"
          />
        </div>
      </EdgeLabelRenderer>

      {/* Hidden path for animateMotion reference */}
      <path id={id} d={edgePath} style={{ display: 'none' }} />
    </>
  );
}

export default memo(AnimatedEdge);
