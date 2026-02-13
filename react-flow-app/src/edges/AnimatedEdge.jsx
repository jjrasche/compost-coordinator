import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react';
import { memo, useRef, useState, useEffect } from 'react';

// Pixels per second — consistent velocity regardless of edge length
const WEEKLY_SPEED = 30;
const MONTHLY_SPEED = 10;

function getSpeed(frequency) {
  if (!frequency) return MONTHLY_SPEED;
  if (frequency.unit === 'weekly') return WEEKLY_SPEED;
  return MONTHLY_SPEED;
}

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

  const pathRef = useRef(null);
  const [duration, setDuration] = useState(null);

  const {
    icons = [],
    bidirectional = false,
    reverseIcons = [],
    frequency,
  } = data || {};

  const speed = getSpeed(frequency);

  useEffect(() => {
    if (pathRef.current) {
      const length = pathRef.current.getTotalLength();
      setDuration(length / speed);
    }
  }, [edgePath, speed]);

  // Don't render animations until we know the duration
  const animDuration = duration || 2;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          strokeDasharray: '8 4',
          animation: `flow ${animDuration}s linear infinite`
        }}
      />

      {/* Forward direction icons */}
      {duration && icons.map((icon, index) => {
        const offset = (index / icons.length) * animDuration;
        return (
          <g key={`forward-${index}`}>
            <text
              fontSize="1.2rem"
              textAnchor="middle"
              dominantBaseline="middle"
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              <animateMotion
                dur={`${animDuration}s`}
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
      {duration && bidirectional && reverseIcons.map((icon, index) => {
        const offset = (index / reverseIcons.length) * animDuration;
        return (
          <g key={`reverse-${index}`}>
            <text
              fontSize="1.2rem"
              textAnchor="middle"
              dominantBaseline="middle"
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              <animateMotion
                dur={`${animDuration}s`}
                repeatCount="indefinite"
                begin={`${offset}s`}
                keyPoints="1;0"
                keyTimes="0;1"
              >
                <mpath href={`#${id}`} />
              </animateMotion>
              {icon}
            </text>
          </g>
        );
      })}

      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="edge-label-clickable"
        >
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

      {/* Path used for animateMotion reference and length measurement */}
      <path ref={pathRef} id={id} d={edgePath} style={{ display: 'none' }} />
    </>
  );
}

export default memo(AnimatedEdge);
