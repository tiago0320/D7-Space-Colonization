/**
 * Unified Grasshopper prep mesh from edited Grid Growth boxes.
 * Occupancy field + marching cubes. No relaxation or sculpting.
 * 1 unit = 1 foot. Domain is the 20' module unless a box is passed in.
 */
(function (global) {
  const CUBE = 20;
  const DIVS = { low: 24, medium: 40, high: 72 };

  const EDGE_TABLE = [
    0x0, 0x109, 0x203, 0x30a, 0x406, 0x50f, 0x605, 0x70c, 0x80c, 0x905, 0xa0f, 0xb06, 0xc0a, 0xd03, 0xe09, 0xf00, 0x190,
    0x99, 0x393, 0x29a, 0x596, 0x49f, 0x795, 0x69c, 0x99c, 0x895, 0xb9f, 0xa96, 0xd9a, 0xc93, 0xf99, 0xe90, 0x230, 0x339,
    0x33, 0x13a, 0x636, 0x73f, 0x435, 0x53c, 0xa3c, 0xb35, 0x83f, 0x936, 0xe3a, 0xf33, 0xc39, 0xd30, 0x3a0, 0x2a9, 0x1a3,
    0xaa, 0x7a6, 0x6af, 0x5a5, 0x4ac, 0xbac, 0xaa5, 0x9af, 0x8a6, 0xfaa, 0xea3, 0xda9, 0xca0, 0x460, 0x569, 0x663, 0x76a,
    0x66, 0x16f, 0x265, 0x36c, 0xc6c, 0xd65, 0xe6f, 0xf66, 0x86a, 0x963, 0xa69, 0xb60, 0x5f0, 0x4f9, 0x7f3, 0x6fa, 0x1f6,
    0xff, 0x3f5, 0x2fc, 0xdfc, 0xcf5, 0xfff, 0xef6, 0x9fa, 0x8f3, 0xbf9, 0xaf0, 0x650, 0x759, 0x453, 0x55a, 0x256, 0x35f,
    0x55, 0x15c, 0xe5c, 0xf55, 0xc5f, 0xd56, 0xa5a, 0xb53, 0x859, 0x950, 0x7c0, 0x6c9, 0x5c3, 0x4ca, 0x3c6, 0x2cf, 0x1c5,
    0xcc, 0xfcc, 0xec5, 0xdcf, 0xc96, 0xbca, 0xac3, 0x9c9, 0x8c0, 0x8c0, 0x9c9, 0xac3, 0xbca, 0xcc6, 0xdcf, 0xec5, 0xfcc,
    0xcc, 0x1c5, 0x2cf, 0x3c6, 0x4ca, 0x5c3, 0x6c9, 0x7c0, 0x950, 0x859, 0xb53, 0xa5a, 0xd56, 0xc5f, 0xf55, 0xe5c, 0x15c,
    0x55, 0x35f, 0x256, 0x55a, 0x453, 0x759, 0x650, 0xaf0, 0xbf9, 0x8f3, 0x9fa, 0xef6, 0xfff, 0xcf5, 0xdfc, 0x2fc, 0x3f5,
    0xff, 0x1f6, 0x6fa, 0x7f3, 0x4f9, 0x5f0, 0xb60, 0xa69, 0x963, 0x86a, 0xf66, 0xe6f, 0xd65, 0xc6c, 0x36c, 0x265, 0x16f,
    0x66, 0x76a, 0x663, 0x569, 0x460, 0xca0, 0xda9, 0xea3, 0xfaa, 0x8a6, 0x9af, 0xaa5, 0xbac, 0x4ac, 0x5a5, 0x6af, 0x7a6,
    0xaa, 0x1a3, 0x2a9, 0x3a0, 0xd30, 0xc39, 0xf33, 0xe3a, 0x936, 0x83f, 0xb35, 0xa3c, 0x53c, 0x435, 0x73f, 0x636, 0x13a,
    0x33, 0x339, 0x230, 0xe90, 0xf99, 0xc93, 0xd9a, 0xa96, 0xb9f, 0x895, 0x99c, 0x69c, 0x795, 0x49f, 0x596, 0x29a, 0x393,
    0x99, 0x190, 0xf00, 0xe09, 0xd03, 0xc0a, 0xb06, 0xa0f, 0x905, 0x80c, 0x70c, 0x605, 0x50f, 0x406, 0x30a, 0x203, 0x109,
    0x0,
  ];

  const TRI_TABLE = [
    [], [0, 8, 3], [0, 1, 9], [1, 8, 3, 9, 8, 1], [1, 2, 10], [0, 8, 3, 1, 2, 10], [9, 2, 10, 0, 2, 9],
    [2, 8, 3, 2, 10, 8, 10, 9, 8], [3, 11, 2], [0, 11, 2, 8, 11, 0], [1, 9, 0, 2, 3, 11],
    [1, 11, 2, 1, 9, 11, 9, 8, 11], [3, 10, 1, 11, 10, 3], [0, 10, 1, 0, 8, 10, 8, 11, 10],
    [3, 9, 0, 3, 11, 9, 11, 10, 9], [9, 8, 10, 10, 8, 11], [4, 7, 8], [4, 3, 0, 7, 3, 4],
    [0, 1, 9, 8, 4, 7], [4, 1, 9, 4, 7, 1, 7, 3, 1], [1, 2, 10, 8, 4, 7], [3, 4, 7, 3, 0, 4, 1, 2, 10],
    [9, 2, 10, 9, 0, 2, 8, 4, 7], [2, 10, 9, 2, 9, 7, 2, 7, 3, 7, 9, 4], [8, 4, 7, 3, 11, 2],
    [11, 4, 7, 11, 2, 4, 2, 0, 4], [9, 0, 1, 8, 4, 7, 2, 3, 11], [4, 7, 11, 9, 4, 11, 9, 11, 2, 9, 2, 1],
    [3, 10, 1, 3, 11, 10, 7, 8, 4], [1, 11, 10, 1, 4, 11, 1, 0, 4, 7, 11, 4],
    [4, 7, 8, 9, 0, 11, 9, 11, 10, 11, 0, 3], [4, 7, 11, 4, 11, 9, 9, 11, 10], [9, 5, 4],
    [9, 5, 4, 0, 8, 3], [0, 5, 4, 1, 5, 0], [8, 5, 4, 8, 3, 5, 3, 1, 5], [1, 2, 10, 9, 5, 4],
    [3, 0, 8, 1, 2, 10, 4, 9, 5], [5, 2, 10, 5, 4, 2, 4, 0, 2], [2, 10, 5, 3, 2, 5, 3, 5, 4, 3, 4, 8],
    [9, 5, 4, 2, 3, 11], [0, 11, 2, 0, 8, 11, 4, 9, 5], [0, 5, 4, 0, 1, 5, 2, 3, 11],
    [2, 1, 5, 2, 5, 8, 2, 8, 11, 4, 8, 5], [10, 3, 11, 10, 1, 3, 9, 5, 4],
    [4, 9, 5, 0, 8, 1, 8, 10, 1, 8, 11, 10], [5, 4, 0, 5, 0, 11, 5, 11, 10, 11, 0, 3],
    [5, 4, 8, 5, 8, 10, 10, 8, 11], [9, 7, 8, 5, 7, 9], [9, 3, 0, 9, 5, 3, 5, 7, 3],
    [0, 7, 8, 0, 1, 7, 1, 5, 7], [1, 5, 3, 3, 5, 7], [9, 7, 8, 9, 5, 7, 10, 1, 2],
    [10, 1, 2, 9, 5, 0, 5, 3, 0, 5, 7, 3], [8, 0, 2, 8, 2, 5, 8, 5, 7, 10, 5, 2],
    [2, 10, 5, 2, 5, 3, 3, 5, 7], [7, 9, 5, 7, 8, 9, 3, 11, 2], [9, 5, 7, 9, 7, 2, 9, 2, 0, 2, 7, 11],
    [2, 3, 11, 0, 1, 8, 1, 7, 8, 1, 5, 7], [11, 2, 1, 11, 1, 7, 7, 1, 5],
    [9, 5, 8, 8, 5, 7, 10, 1, 3, 10, 3, 11], [5, 7, 0, 5, 0, 9, 7, 11, 0, 1, 0, 10, 11, 10, 0],
    [11, 10, 0, 11, 0, 3, 10, 5, 0, 8, 0, 7, 5, 7, 0], [11, 10, 5, 7, 11, 5], [10, 6, 5],
    [0, 8, 3, 5, 10, 6], [9, 0, 1, 5, 10, 6], [1, 8, 3, 1, 9, 8, 5, 10, 6], [1, 6, 5, 2, 6, 1],
    [1, 6, 5, 1, 2, 6, 3, 0, 8], [9, 6, 5, 9, 0, 6, 0, 2, 6], [5, 9, 8, 5, 8, 2, 5, 2, 6, 3, 2, 8],
    [2, 3, 11, 10, 6, 5], [11, 0, 8, 11, 2, 0, 10, 6, 5], [0, 1, 9, 2, 3, 11, 5, 10, 6],
    [5, 10, 6, 1, 9, 2, 9, 11, 2, 9, 8, 11], [6, 3, 11, 6, 5, 3, 5, 1, 3],
    [0, 8, 11, 0, 11, 5, 0, 5, 1, 5, 11, 6], [3, 11, 6, 0, 3, 6, 0, 6, 5, 0, 5, 9],
    [6, 5, 9, 6, 9, 11, 11, 9, 8], [5, 10, 6, 4, 7, 8], [4, 3, 0, 4, 7, 3, 6, 5, 10],
    [1, 9, 0, 5, 10, 6, 8, 4, 7], [10, 6, 5, 1, 9, 7, 1, 7, 3, 7, 9, 4], [6, 1, 2, 6, 5, 1, 4, 7, 8],
    [1, 2, 5, 5, 2, 6, 3, 0, 4, 3, 4, 7], [8, 4, 7, 9, 0, 5, 0, 6, 5, 0, 2, 6],
    [7, 3, 9, 7, 9, 4, 3, 2, 9, 5, 9, 6, 2, 6, 9], [3, 11, 2, 7, 8, 4, 10, 6, 5],
    [5, 10, 6, 4, 7, 2, 4, 2, 0, 2, 7, 11], [0, 1, 9, 4, 7, 8, 2, 3, 11, 5, 10, 6],
    [9, 2, 1, 9, 11, 2, 9, 4, 11, 7, 11, 4, 5, 10, 6], [8, 4, 7, 3, 11, 5, 3, 5, 1, 5, 11, 6],
    [5, 1, 11, 5, 11, 6, 1, 0, 11, 7, 11, 4, 0, 4, 11], [0, 5, 9, 0, 6, 5, 0, 3, 6, 11, 6, 3, 8, 4, 7],
    [6, 5, 9, 6, 9, 11, 4, 7, 9, 7, 11, 9], [10, 4, 9, 6, 4, 10], [4, 10, 6, 4, 9, 10, 0, 8, 3],
    [10, 0, 1, 10, 6, 0, 6, 4, 0], [8, 3, 1, 8, 1, 6, 8, 6, 4, 6, 1, 10], [1, 4, 9, 1, 2, 4, 2, 6, 4],
    [3, 0, 8, 1, 2, 9, 2, 4, 9, 2, 6, 4], [0, 2, 4, 4, 2, 6], [8, 3, 2, 8, 2, 4, 4, 2, 6],
    [10, 4, 9, 10, 6, 4, 11, 2, 3], [0, 8, 2, 2, 8, 11, 4, 9, 10, 4, 10, 6],
    [3, 11, 2, 0, 1, 6, 0, 6, 4, 6, 1, 10], [6, 4, 1, 6, 1, 10, 4, 8, 1, 2, 1, 11, 8, 11, 1],
    [9, 6, 4, 9, 3, 6, 9, 1, 3, 11, 6, 3], [8, 11, 1, 8, 1, 0, 11, 6, 1, 9, 1, 4, 6, 4, 1],
    [3, 11, 6, 3, 6, 0, 0, 6, 4], [6, 4, 8, 11, 6, 8], [7, 10, 6, 7, 8, 10, 8, 9, 10],
    [0, 7, 3, 0, 10, 7, 0, 9, 10, 6, 7, 10], [10, 6, 7, 1, 10, 7, 1, 7, 8, 1, 8, 0],
    [10, 6, 7, 10, 7, 1, 1, 7, 3], [1, 2, 6, 1, 6, 8, 1, 8, 9, 8, 6, 7],
    [2, 6, 9, 2, 9, 1, 6, 7, 9, 0, 9, 3, 7, 3, 9], [7, 8, 0, 7, 0, 6, 6, 0, 2], [7, 3, 2, 6, 7, 2],
    [2, 3, 11, 10, 6, 8, 10, 8, 9, 8, 6, 7], [2, 0, 7, 2, 7, 11, 0, 9, 7, 6, 7, 10, 9, 10, 7],
    [1, 8, 0, 1, 7, 8, 1, 10, 7, 6, 7, 10, 2, 3, 11], [11, 2, 1, 11, 1, 7, 10, 6, 1, 6, 7, 1],
    [8, 9, 6, 8, 6, 7, 9, 1, 6, 11, 6, 3, 1, 3, 6], [0, 9, 1, 11, 6, 7],
    [7, 8, 0, 7, 0, 6, 3, 11, 0, 11, 6, 0], [7, 11, 6], [7, 6, 11], [3, 0, 8, 11, 7, 6],
    [0, 1, 9, 11, 7, 6], [8, 1, 9, 8, 3, 1, 11, 7, 6], [10, 1, 2, 6, 11, 7],
    [1, 2, 10, 3, 0, 8, 6, 11, 7], [2, 9, 0, 2, 10, 9, 6, 11, 7],
    [6, 11, 7, 2, 10, 3, 10, 8, 3, 10, 9, 8], [7, 2, 3, 6, 2, 7], [7, 0, 8, 7, 6, 0, 6, 2, 0],
    [2, 7, 6, 2, 3, 7, 0, 1, 9], [1, 6, 2, 1, 8, 6, 1, 9, 8, 8, 7, 6], [10, 7, 6, 10, 1, 7, 1, 3, 7],
    [10, 7, 6, 1, 7, 10, 1, 8, 7, 1, 0, 8], [0, 3, 7, 0, 7, 10, 0, 10, 9, 6, 10, 7],
    [7, 6, 10, 7, 10, 8, 8, 10, 9], [6, 8, 4, 11, 8, 6], [3, 6, 11, 3, 0, 6, 0, 4, 6],
    [8, 6, 11, 8, 4, 6, 9, 0, 1], [9, 4, 6, 9, 6, 3, 9, 3, 1, 11, 3, 6], [6, 8, 4, 6, 11, 8, 2, 10, 1],
    [1, 2, 10, 3, 0, 11, 0, 6, 11, 0, 4, 6], [4, 11, 8, 4, 6, 11, 0, 2, 9, 2, 10, 9],
    [10, 9, 3, 10, 3, 2, 9, 4, 3, 11, 3, 6, 4, 6, 3], [8, 2, 3, 8, 4, 2, 4, 6, 2], [0, 4, 2, 4, 6, 2],
    [1, 9, 0, 2, 3, 4, 2, 4, 6, 4, 3, 8], [1, 9, 4, 1, 4, 2, 2, 4, 6],
    [8, 1, 3, 8, 6, 1, 8, 4, 6, 6, 10, 1], [10, 1, 0, 10, 0, 6, 6, 0, 4],
    [4, 6, 3, 4, 3, 8, 6, 10, 3, 0, 3, 9, 10, 9, 3], [10, 9, 4, 6, 10, 4], [4, 9, 5, 7, 6, 11],
    [0, 8, 3, 4, 9, 5, 11, 7, 6], [5, 0, 1, 5, 4, 0, 7, 6, 11], [11, 7, 6, 8, 3, 4, 3, 5, 4, 3, 1, 5],
    [9, 5, 4, 10, 1, 2, 7, 6, 11], [6, 11, 7, 1, 2, 10, 0, 8, 3, 4, 9, 5],
    [7, 6, 11, 5, 4, 10, 4, 2, 10, 4, 0, 2], [3, 4, 8, 3, 5, 4, 3, 2, 5, 10, 5, 2, 11, 7, 6],
    [7, 2, 3, 7, 6, 2, 5, 4, 9], [9, 5, 4, 0, 8, 6, 0, 6, 2, 6, 8, 7],
    [3, 6, 2, 3, 7, 6, 1, 5, 0, 5, 4, 0], [6, 2, 8, 6, 8, 7, 2, 1, 8, 4, 8, 5, 1, 5, 8],
    [9, 5, 4, 10, 1, 6, 1, 7, 6, 1, 3, 7], [1, 6, 10, 1, 7, 6, 1, 0, 7, 8, 7, 0, 9, 5, 4],
    [4, 0, 10, 4, 10, 5, 0, 3, 10, 6, 10, 7, 3, 7, 10], [7, 6, 10, 7, 10, 8, 5, 4, 10, 4, 8, 10],
    [6, 9, 5, 6, 11, 9, 11, 8, 9], [3, 6, 11, 0, 6, 3, 0, 5, 6, 0, 9, 5],
    [0, 11, 8, 0, 5, 11, 0, 1, 5, 5, 6, 11], [6, 11, 3, 6, 3, 5, 5, 3, 1],
    [1, 2, 10, 9, 5, 11, 9, 11, 8, 11, 5, 6], [0, 11, 3, 0, 6, 11, 0, 9, 6, 5, 6, 9, 1, 2, 10],
    [11, 8, 5, 11, 5, 6, 8, 0, 5, 10, 5, 2, 0, 2, 5], [6, 11, 3, 6, 3, 5, 2, 10, 3, 10, 5, 3],
    [5, 8, 9, 5, 2, 8, 5, 6, 2, 3, 8, 2], [9, 5, 6, 9, 6, 0, 0, 6, 2],
    [1, 5, 8, 1, 8, 0, 5, 6, 8, 3, 8, 2, 6, 2, 8], [1, 5, 6, 2, 1, 6],
    [1, 3, 6, 1, 6, 10, 3, 8, 6, 5, 6, 9, 8, 9, 6], [10, 1, 0, 10, 0, 6, 9, 5, 0, 5, 6, 0],
    [0, 3, 8, 5, 6, 10], [10, 5, 6], [11, 5, 10, 7, 5, 11], [11, 5, 10, 11, 7, 5, 8, 3, 0],
    [5, 11, 7, 5, 10, 11, 1, 9, 0], [10, 7, 5, 10, 11, 7, 9, 8, 1, 8, 3, 1], [11, 1, 2, 11, 7, 1, 7, 5, 1],
    [0, 8, 3, 1, 2, 7, 1, 7, 5, 7, 2, 11], [9, 7, 5, 9, 2, 7, 9, 0, 2, 2, 11, 7],
    [7, 5, 2, 7, 2, 11, 5, 9, 2, 3, 2, 8, 9, 8, 2], [2, 5, 10, 2, 3, 5, 3, 7, 5],
    [8, 2, 0, 8, 5, 2, 8, 7, 5, 10, 2, 5], [9, 0, 1, 5, 10, 3, 5, 3, 7, 3, 10, 2],
    [9, 8, 2, 9, 2, 1, 8, 7, 2, 10, 2, 5, 7, 5, 2], [1, 3, 5, 3, 7, 5],
    [0, 8, 7, 0, 7, 1, 1, 7, 5], [9, 0, 3, 9, 3, 5, 5, 3, 7], [9, 8, 7, 5, 9, 7],
    [5, 8, 4, 5, 10, 8, 10, 11, 8], [5, 0, 4, 5, 11, 0, 5, 10, 11, 11, 3, 0],
    [0, 1, 9, 8, 4, 10, 8, 10, 11, 10, 4, 5], [10, 11, 4, 10, 4, 5, 11, 3, 4, 9, 4, 1, 3, 1, 4],
    [2, 5, 1, 2, 8, 5, 2, 11, 8, 4, 5, 8], [0, 4, 11, 0, 11, 3, 4, 5, 11, 2, 11, 1, 5, 1, 11],
    [0, 2, 5, 0, 5, 9, 2, 11, 5, 4, 5, 8, 11, 8, 5], [9, 4, 5, 2, 11, 3],
    [2, 5, 10, 3, 5, 2, 3, 4, 5, 3, 8, 4], [5, 10, 2, 5, 2, 4, 4, 2, 0],
    [3, 10, 2, 3, 5, 10, 3, 8, 5, 4, 5, 8, 0, 1, 9], [5, 10, 2, 5, 2, 4, 1, 9, 2, 9, 4, 2],
    [8, 4, 5, 8, 5, 3, 3, 5, 1], [0, 4, 5, 1, 0, 5], [8, 4, 5, 8, 5, 3, 9, 0, 5, 0, 3, 5], [9, 4, 5],
    [4, 11, 7, 4, 9, 11, 9, 10, 11], [0, 8, 3, 4, 9, 7, 9, 11, 7, 9, 10, 11],
    [1, 10, 11, 1, 11, 4, 1, 4, 0, 7, 4, 11], [3, 1, 4, 3, 4, 8, 1, 10, 4, 7, 4, 11, 10, 11, 4],
    [4, 11, 7, 9, 11, 4, 9, 2, 11, 9, 1, 2], [9, 7, 4, 9, 11, 7, 9, 1, 11, 2, 11, 1, 0, 8, 3],
    [11, 7, 4, 11, 4, 2, 2, 4, 0], [11, 7, 4, 11, 4, 2, 8, 3, 4, 3, 2, 4],
    [2, 9, 10, 2, 7, 9, 2, 3, 7, 7, 4, 9], [9, 10, 7, 9, 7, 4, 10, 2, 7, 8, 7, 0, 2, 0, 7],
    [3, 7, 10, 3, 10, 2, 7, 4, 10, 1, 10, 0, 4, 0, 10], [1, 10, 2, 8, 7, 4],
    [4, 9, 1, 4, 1, 7, 7, 1, 3], [4, 9, 1, 4, 1, 7, 0, 8, 1, 8, 7, 1], [4, 0, 3, 7, 4, 3], [4, 8, 7],
    [9, 10, 8, 10, 11, 8], [3, 0, 9, 3, 9, 11, 11, 9, 10], [0, 1, 10, 0, 10, 8, 8, 10, 11],
    [3, 1, 10, 11, 3, 10], [1, 2, 11, 1, 11, 9, 9, 11, 8], [3, 0, 9, 3, 9, 11, 1, 2, 9, 2, 11, 9],
    [0, 2, 11, 8, 0, 11], [3, 2, 11], [2, 3, 8, 2, 8, 10, 10, 8, 9], [9, 10, 2, 0, 9, 2],
    [2, 3, 8, 2, 8, 10, 0, 1, 8, 1, 10, 8], [1, 10, 2], [1, 3, 8, 9, 1, 8], [0, 9, 1], [0, 3, 8], [],
  ];

  function normalizeRes(value) {
    const s = String(value || "medium").toLowerCase();
    if (s === "low" || s === "high") return s;
    return "medium";
  }

  function divisionsFor(res) {
    return DIVS[normalizeRes(res)] || DIVS.medium;
  }

  function readBox(box) {
    const b = box || {};
    const minx = Number.isFinite(Number(b.minx)) ? Number(b.minx) : 0;
    const miny = Number.isFinite(Number(b.miny)) ? Number(b.miny) : 0;
    const minz = Number.isFinite(Number(b.minz)) ? Number(b.minz) : 0;
    const maxx = Number.isFinite(Number(b.maxx)) ? Number(b.maxx) : CUBE;
    const maxy = Number.isFinite(Number(b.maxy)) ? Number(b.maxy) : CUBE;
    const maxz = Number.isFinite(Number(b.maxz)) ? Number(b.maxz) : CUBE;
    return {
      minx,
      miny,
      minz,
      maxx: maxx > minx ? maxx : minx + CUBE,
      maxy: maxy > miny ? maxy : miny + CUBE,
      maxz: maxz > minz ? maxz : minz + CUBE,
    };
  }

  function pointInElement(px, py, pz, el, pad) {
    const eps = pad > 0 ? pad : 1e-6;
    if (el.solidOrigin && el.solidAxisU && el.solidAxisW && el.solidAxisT) {
      const o = el.solidOrigin;
      const u = el.solidAxisU;
      const w = el.solidAxisW;
      const t = el.solidAxisT;
      const dx = px - o.x;
      const dy = py - o.y;
      const dz = pz - o.z;
      const lu2 = u.x * u.x + u.y * u.y + u.z * u.z;
      const lw2 = w.x * w.x + w.y * w.y + w.z * w.z;
      const lt2 = t.x * t.x + t.y * t.y + t.z * t.z;
      if (lu2 < 1e-16 || lw2 < 1e-16 || lt2 < 1e-16) return false;
      const su = (dx * u.x + dy * u.y + dz * u.z) / lu2;
      const sw = (dx * w.x + dy * w.y + dz * w.z) / lw2;
      const st = (dx * t.x + dy * t.y + dz * t.z) / lt2;
      const pu = eps / Math.sqrt(lu2);
      const pw = eps / Math.sqrt(lw2);
      const pt = eps / Math.sqrt(lt2);
      return su >= -pu && su <= 1 + pu && sw >= -pw && sw <= 1 + pw && st >= -pt && st <= 1 + pt;
    }
    if (el.center && el.U && el.hu != null && el.hw != null && el.ht != null) {
      const dx = px - el.center.x;
      const dy = py - el.center.y;
      const dz = pz - el.center.z;
      const su = dx * el.U.x + dy * el.U.y + dz * el.U.z;
      const sw = dx * el.W.x + dy * el.W.y + dz * el.W.z;
      const st = dx * el.T.x + dy * el.T.y + dz * el.T.z;
      return Math.abs(su) <= Number(el.hu) + eps && Math.abs(sw) <= Number(el.hw) + eps && Math.abs(st) <= Number(el.ht) + eps;
    }
    return false;
  }

  function elementWorldAABB(el, pad) {
    const p = pad > 0 ? pad : 0;
    const corners = [];
    if (el.solidOrigin && el.solidAxisU && el.solidAxisW && el.solidAxisT) {
      const o = el.solidOrigin;
      const u = el.solidAxisU;
      const w = el.solidAxisW;
      const t = el.solidAxisT;
      for (let iu = 0; iu <= 1; iu++) {
        for (let iw = 0; iw <= 1; iw++) {
          for (let it = 0; it <= 1; it++) {
            corners.push([
              o.x + u.x * iu + w.x * iw + t.x * it,
              o.y + u.y * iu + w.y * iw + t.y * it,
              o.z + u.z * iu + w.z * iw + t.z * it,
            ]);
          }
        }
      }
    } else if (el.center && el.U && el.hu != null) {
      const c = el.center;
      const U = el.U;
      const W = el.W;
      const T = el.T;
      const hu = Number(el.hu);
      const hw = Number(el.hw);
      const ht = Number(el.ht);
      for (let su = -1; su <= 1; su += 2) {
        for (let sw = -1; sw <= 1; sw += 2) {
          for (let st = -1; st <= 1; st += 2) {
            corners.push([
              c.x + U.x * hu * su + W.x * hw * sw + T.x * ht * st,
              c.y + U.y * hu * su + W.y * hw * sw + T.y * ht * st,
              c.z + U.z * hu * su + W.z * hw * sw + T.z * ht * st,
            ]);
          }
        }
      }
    } else if (el.positions && el.positions.length >= 3) {
      const pos = el.positions;
      let minx = Infinity;
      let miny = Infinity;
      let minz = Infinity;
      let maxx = -Infinity;
      let maxy = -Infinity;
      let maxz = -Infinity;
      for (let i = 0; i < pos.length; i += 3) {
        if (pos[i] < minx) minx = pos[i];
        if (pos[i + 1] < miny) miny = pos[i + 1];
        if (pos[i + 2] < minz) minz = pos[i + 2];
        if (pos[i] > maxx) maxx = pos[i];
        if (pos[i + 1] > maxy) maxy = pos[i + 1];
        if (pos[i + 2] > maxz) maxz = pos[i + 2];
      }
      return { minx: minx - p, miny: miny - p, minz: minz - p, maxx: maxx + p, maxy: maxy + p, maxz: maxz + p };
    } else {
      return null;
    }
    let minx = Infinity;
    let miny = Infinity;
    let minz = Infinity;
    let maxx = -Infinity;
    let maxy = -Infinity;
    let maxz = -Infinity;
    for (let i = 0; i < corners.length; i++) {
      const c = corners[i];
      if (c[0] < minx) minx = c[0];
      if (c[1] < miny) miny = c[1];
      if (c[2] < minz) minz = c[2];
      if (c[0] > maxx) maxx = c[0];
      if (c[1] > maxy) maxy = c[1];
      if (c[2] > maxz) maxz = c[2];
    }
    return { minx: minx - p, miny: miny - p, minz: minz - p, maxx: maxx + p, maxy: maxy + p, maxz: maxz + p };
  }

  function rasterize(elements, domain, n) {
    const sx = (domain.maxx - domain.minx) / n;
    const sy = (domain.maxy - domain.miny) / n;
    const sz = (domain.maxz - domain.minz) / n;
    const pad = 0.51 * Math.min(sx, sy, sz);
    const ghost = 1;
    const dim = n + 1 + ghost * 2;
    const occ = new Uint8Array(dim * dim * dim);
    const idx = (ix, iy, iz) => ix + dim * (iy + dim * iz);
    const originX = domain.minx - ghost * sx;
    const originY = domain.miny - ghost * sy;
    const originZ = domain.minz - ghost * sz;
    for (let e = 0; e < elements.length; e++) {
      const el = elements[e];
      if (!el || el.deleted) continue;
      const aabb = elementWorldAABB(el, pad);
      if (!aabb) continue;
      const ix0 = Math.max(ghost, Math.floor((aabb.minx - originX) / sx));
      const iy0 = Math.max(ghost, Math.floor((aabb.miny - originY) / sy));
      const iz0 = Math.max(ghost, Math.floor((aabb.minz - originZ) / sz));
      const ix1 = Math.min(ghost + n, Math.ceil((aabb.maxx - originX) / sx));
      const iy1 = Math.min(ghost + n, Math.ceil((aabb.maxy - originY) / sy));
      const iz1 = Math.min(ghost + n, Math.ceil((aabb.maxz - originZ) / sz));
      for (let iz = iz0; iz <= iz1; iz++) {
        const z = originZ + iz * sz;
        for (let iy = iy0; iy <= iy1; iy++) {
          const y = originY + iy * sy;
          for (let ix = ix0; ix <= ix1; ix++) {
            const x = originX + ix * sx;
            if (pointInElement(x, y, z, el, pad)) occ[idx(ix, iy, iz)] = 1;
          }
        }
      }
    }
    return { occ, dim, sx, sy, sz, domain, n, originX, originY, originZ };
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function marchingCubes(grid) {
    const { occ, dim, sx, sy, sz, originX, originY, originZ } = grid;
    const ox = originX != null ? originX : grid.domain.minx;
    const oy = originY != null ? originY : grid.domain.miny;
    const oz = originZ != null ? originZ : grid.domain.minz;
    const positions = [];
    const indices = [];
    const idx = (ix, iy, iz) => ix + dim * (iy + dim * iz);
    const vertCache = {};
    const iso = grid.iso != null ? grid.iso : 0.5;
    function edgeVert(ax, ay, az, bx, by, bz, aVal, bVal, key) {
      if (vertCache[key] != null) return vertCache[key];
      const t = aVal === bVal ? 0.5 : (iso - aVal) / (bVal - aVal);
      const id = positions.length / 3;
      positions.push(
        lerp(ox + ax * sx, ox + bx * sx, t),
        lerp(oy + ay * sy, oy + by * sy, t),
        lerp(oz + az * sz, oz + bz * sz, t)
      );
      vertCache[key] = id;
      return id;
    }
    const cornerOff = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ];
    for (let iz = 0; iz < dim - 1; iz++) {
      for (let iy = 0; iy < dim - 1; iy++) {
        for (let ix = 0; ix < dim - 1; ix++) {
          let cubeIndex = 0;
          const vals = new Array(8);
          for (let c = 0; c < 8; c++) {
            const o = cornerOff[c];
            vals[c] = Number(occ[idx(ix + o[0], iy + o[1], iz + o[2])]) || 0;
            if (vals[c] < iso) cubeIndex |= 1 << c;
          }
          const edges = EDGE_TABLE[cubeIndex];
          if (!edges) continue;
          const vertList = new Array(12);
          if (edges & 1) vertList[0] = edgeVert(ix, iy, iz, ix + 1, iy, iz, vals[0], vals[1], ix + "," + iy + "," + iz + ":0");
          if (edges & 2) vertList[1] = edgeVert(ix + 1, iy, iz, ix + 1, iy + 1, iz, vals[1], vals[2], ix + 1 + "," + iy + "," + iz + ":1");
          if (edges & 4) vertList[2] = edgeVert(ix + 1, iy + 1, iz, ix, iy + 1, iz, vals[2], vals[3], ix + "," + (iy + 1) + "," + iz + ":0");
          if (edges & 8) vertList[3] = edgeVert(ix, iy + 1, iz, ix, iy, iz, vals[3], vals[0], ix + "," + iy + "," + iz + ":1");
          if (edges & 16) vertList[4] = edgeVert(ix, iy, iz + 1, ix + 1, iy, iz + 1, vals[4], vals[5], ix + "," + iy + "," + (iz + 1) + ":0");
          if (edges & 32) vertList[5] = edgeVert(ix + 1, iy, iz + 1, ix + 1, iy + 1, iz + 1, vals[5], vals[6], ix + 1 + "," + iy + "," + (iz + 1) + ":1");
          if (edges & 64) vertList[6] = edgeVert(ix + 1, iy + 1, iz + 1, ix, iy + 1, iz + 1, vals[6], vals[7], ix + "," + (iy + 1) + "," + (iz + 1) + ":0");
          if (edges & 128) vertList[7] = edgeVert(ix, iy + 1, iz + 1, ix, iy, iz + 1, vals[7], vals[4], ix + "," + iy + "," + (iz + 1) + ":1");
          if (edges & 256) vertList[8] = edgeVert(ix, iy, iz, ix, iy, iz + 1, vals[0], vals[4], ix + "," + iy + "," + iz + ":2");
          if (edges & 512) vertList[9] = edgeVert(ix + 1, iy, iz, ix + 1, iy, iz + 1, vals[1], vals[5], ix + 1 + "," + iy + "," + iz + ":2");
          if (edges & 1024) vertList[10] = edgeVert(ix + 1, iy + 1, iz, ix + 1, iy + 1, iz + 1, vals[2], vals[6], ix + 1 + "," + (iy + 1) + "," + iz + ":2");
          if (edges & 2048) vertList[11] = edgeVert(ix, iy + 1, iz, ix, iy + 1, iz + 1, vals[3], vals[7], ix + "," + (iy + 1) + "," + iz + ":2");
          const tri = TRI_TABLE[cubeIndex];
          if (!tri || !tri.length) continue;
          for (let t = 0; t < tri.length; t += 3) {
            const ia = vertList[tri[t]];
            const ib = vertList[tri[t + 1]];
            const ic = vertList[tri[t + 2]];
            if (ia == null || ib == null || ic == null) continue;
            indices.push(ia, ib, ic);
          }
        }
      }
    }
    return { positions, indices };
  }

  function weldMesh(positions, indices, eps) {
    const tol = eps > 0 ? eps : 1e-5;
    const scale = 1 / tol;
    const map = {};
    const verts = [];
    const remap = [];
    for (let i = 0; i < positions.length; i += 3) {
      const key =
        Math.round(positions[i] * scale) +
        "," +
        Math.round(positions[i + 1] * scale) +
        "," +
        Math.round(positions[i + 2] * scale);
      let id = map[key];
      if (id == null) {
        id = verts.length / 3;
        map[key] = id;
        verts.push(positions[i], positions[i + 1], positions[i + 2]);
      }
      remap.push(id);
    }
    const out = [];
    const seen = {};
    for (let i = 0; i < indices.length; i += 3) {
      let a = remap[indices[i]];
      let b = remap[indices[i + 1]];
      let c = remap[indices[i + 2]];
      if (a === b || b === c || c === a) continue;
      const ax = verts[a * 3];
      const ay = verts[a * 3 + 1];
      const az = verts[a * 3 + 2];
      const bx = verts[b * 3];
      const by = verts[b * 3 + 1];
      const bz = verts[b * 3 + 2];
      const cx = verts[c * 3];
      const cy = verts[c * 3 + 1];
      const cz = verts[c * 3 + 2];
      const abx = bx - ax;
      const aby = by - ay;
      const abz = bz - az;
      const acx = cx - ax;
      const acy = cy - ay;
      const acz = cz - az;
      const nx = aby * acz - abz * acy;
      const ny = abz * acx - abx * acz;
      const nz = abx * acy - aby * acx;
      if (nx * nx + ny * ny + nz * nz < 1e-16) continue;
      const key = a < b && a < c ? a + ":" + (b < c ? b + ":" + c : c + ":" + b) : b < c ? b + ":" + (a < c ? a + ":" + c : c + ":" + a) : c + ":" + (a < b ? a + ":" + b : b + ":" + a);
      if (seen[key]) continue;
      seen[key] = 1;
      out.push(a, b, c);
    }
    return { positions: verts, indices: out };
  }

  function signedVolume(positions, indices) {
    let vol = 0;
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i] * 3;
      const b = indices[i + 1] * 3;
      const c = indices[i + 2] * 3;
      const ax = positions[a];
      const ay = positions[a + 1];
      const az = positions[a + 2];
      const bx = positions[b];
      const by = positions[b + 1];
      const bz = positions[b + 2];
      const cx = positions[c];
      const cy = positions[c + 1];
      const cz = positions[c + 2];
      vol += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    }
    return vol / 6;
  }

  function flipIndices(indices) {
    const out = indices.slice();
    for (let i = 0; i < out.length; i += 3) {
      const t = out[i + 1];
      out[i + 1] = out[i + 2];
      out[i + 2] = t;
    }
    return out;
  }

  function computeNormals(positions, indices) {
    const normals = new Array(positions.length).fill(0);
    for (let i = 0; i < indices.length; i += 3) {
      const ia = indices[i] * 3;
      const ib = indices[i + 1] * 3;
      const ic = indices[i + 2] * 3;
      const ax = positions[ia];
      const ay = positions[ia + 1];
      const az = positions[ia + 2];
      const bx = positions[ib];
      const by = positions[ib + 1];
      const bz = positions[ib + 2];
      const cx = positions[ic];
      const cy = positions[ic + 1];
      const cz = positions[ic + 2];
      const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
      const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      normals[ia] += nx;
      normals[ia + 1] += ny;
      normals[ia + 2] += nz;
      normals[ib] += nx;
      normals[ib + 1] += ny;
      normals[ib + 2] += nz;
      normals[ic] += nx;
      normals[ic + 1] += ny;
      normals[ic + 2] += nz;
    }
    for (let i = 0; i < normals.length; i += 3) {
      const L = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
      if (L < 1e-12) {
        normals[i] = 0;
        normals[i + 1] = 1;
        normals[i + 2] = 0;
      } else {
        normals[i] /= L;
        normals[i + 1] /= L;
        normals[i + 2] /= L;
      }
    }
    return normals;
  }

  function clampToBox(positions, box) {
    for (let i = 0; i < positions.length; i += 3) {
      if (positions[i] < box.minx) positions[i] = box.minx;
      if (positions[i] > box.maxx) positions[i] = box.maxx;
      if (positions[i + 1] < box.miny) positions[i + 1] = box.miny;
      if (positions[i + 1] > box.maxy) positions[i + 1] = box.maxy;
      if (positions[i + 2] < box.minz) positions[i + 2] = box.minz;
      if (positions[i + 2] > box.maxz) positions[i + 2] = box.maxz;
    }
  }

  function parentOf(parent, i) {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }

  function validateMesh(positions, indices, box) {
    const issues = [];
    const nV = Math.floor(positions.length / 3);
    const edgeUse = {};
    const faceSeen = {};
    let degenerate = 0;
    let duplicate = 0;
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i];
      const b = indices[i + 1];
      const c = indices[i + 2];
      if (a < 0 || b < 0 || c < 0 || a >= nV || b >= nV || c >= nV || a === b || b === c || c === a) {
        degenerate += 1;
        continue;
      }
      const ax = positions[a * 3];
      const ay = positions[a * 3 + 1];
      const az = positions[a * 3 + 2];
      const bx = positions[b * 3];
      const by = positions[b * 3 + 1];
      const bz = positions[b * 3 + 2];
      const cx = positions[c * 3];
      const cy = positions[c * 3 + 1];
      const cz = positions[c * 3 + 2];
      const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
      const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (nx * nx + ny * ny + nz * nz < 1e-16) {
        degenerate += 1;
        continue;
      }
      const canon = [a, b, c].sort((x, y) => x - y).join(":");
      if (faceSeen[canon]) duplicate += 1;
      else faceSeen[canon] = 1;
      function use(u, v) {
        const key = u < v ? u + ":" + v : v + ":" + u;
        edgeUse[key] = (edgeUse[key] || 0) + 1;
      }
      use(a, b);
      use(b, c);
      use(c, a);
    }
    let naked = 0;
    let nonmanifold = 0;
    for (const key in edgeUse) {
      if (!Object.prototype.hasOwnProperty.call(edgeUse, key)) continue;
      if (edgeUse[key] === 1) naked += 1;
      else if (edgeUse[key] > 2) nonmanifold += 1;
    }
    let outside = 0;
    const pad = 1e-3;
    for (let i = 0; i < positions.length; i += 3) {
      if (
        positions[i] < box.minx - pad ||
        positions[i] > box.maxx + pad ||
        positions[i + 1] < box.miny - pad ||
        positions[i + 1] > box.maxy + pad ||
        positions[i + 2] < box.minz - pad ||
        positions[i + 2] > box.maxz + pad
      ) {
        outside += 1;
      }
    }
    const parent = new Array(nV);
    for (let i = 0; i < nV; i++) parent[i] = i;
    const used = new Uint8Array(nV);
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i];
      const b = indices[i + 1];
      const c = indices[i + 2];
      if (a == null || b == null || c == null) continue;
      used[a] = 1;
      used[b] = 1;
      used[c] = 1;
      const pa = parentOf(parent, a);
      const pb = parentOf(parent, b);
      const pc = parentOf(parent, c);
      parent[pb] = pa;
      parent[pc] = pa;
    }
    const roots = {};
    let components = 0;
    for (let i = 0; i < nV; i++) {
      if (!used[i]) continue;
      const r = parentOf(parent, i);
      if (!roots[r]) {
        roots[r] = 1;
        components += 1;
      }
    }
    if (degenerate) issues.push("degenerate-triangles:" + degenerate);
    if (duplicate) issues.push("duplicate-faces:" + duplicate);
    if (naked) issues.push("naked-edges:" + naked);
    if (nonmanifold) issues.push("nonmanifold-edges:" + nonmanifold);
    if (outside) issues.push("outside-module:" + outside);
    return {
      ok: issues.length === 0,
      closed: naked === 0 && nonmanifold === 0,
      issues,
      components,
      naked,
      nonmanifold,
      degenerate,
      duplicate,
      outside,
      vertexCount: nV,
      triangleCount: Math.floor(indices.length / 3),
    };
  }

  function sourceHash(elements) {
    let h = 5381;
    function feed(v) {
      const s = String(v);
      for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) + s.charCodeAt(i)) >>> 0;
    }
    function q(n) {
      return Math.round(Number(n) * 1e4) / 1e4;
    }
    const list = elements || [];
    feed(list.length);
    for (let i = 0; i < list.length; i++) {
      const el = list[i];
      if (!el) continue;
      feed(el.id != null ? el.id : i);
      feed(el.clipped ? 1 : 0);
      if (el.center) {
        feed(q(el.center.x));
        feed(q(el.center.y));
        feed(q(el.center.z));
      }
      feed(q(el.hu));
      feed(q(el.hw));
      feed(q(el.ht));
      if (el.U) {
        feed(q(el.U.x));
        feed(q(el.U.y));
        feed(q(el.U.z));
      }
      if (el.solidOrigin) {
        feed(q(el.solidOrigin.x));
        feed(q(el.solidOrigin.y));
        feed(q(el.solidOrigin.z));
      }
      if (el.solidAxisU) {
        feed(q(el.solidAxisU.x));
        feed(q(el.solidAxisU.y));
        feed(q(el.solidAxisU.z));
      }
      if (el.positions) feed(el.positions.length);
    }
    return ("00000000" + h.toString(16)).slice(-8).toUpperCase();
  }

  function extractIso(field, options) {
    const opts = options || {};
    const n = Math.max(8, Math.min(72, (opts.n | 0) || 22));
    const ghost = opts.ghost != null ? opts.ghost : 1;
    const domain = readBox(opts.box);
    const sx = (domain.maxx - domain.minx) / n;
    const sy = (domain.maxy - domain.miny) / n;
    const sz = (domain.maxz - domain.minz) / n;
    const dim = opts.dim || n + 1 + ghost * 2;
    if (!field || field.length < dim * dim * dim) {
      throw new Error("Surface field is empty.");
    }
    const raw = marchingCubes({
      occ: field,
      dim: dim,
      sx: sx,
      sy: sy,
      sz: sz,
      originX: opts.originX != null ? opts.originX : domain.minx - ghost * sx,
      originY: opts.originY != null ? opts.originY : domain.miny - ghost * sy,
      originZ: opts.originZ != null ? opts.originZ : domain.minz - ghost * sz,
      domain: domain,
      iso: opts.iso != null ? opts.iso : 0.42,
    });
    if (!raw.indices.length) throw new Error("Surface mesh is empty.");
    let welded = weldMesh(raw.positions, raw.indices, 1e-5);
    clampToBox(welded.positions, domain);
    welded = weldMesh(welded.positions, welded.indices, 1e-4);
    let positions = welded.positions;
    let indices = welded.indices;
    if (signedVolume(positions, indices) < 0) indices = flipIndices(indices);
    const normals = computeNormals(positions, indices);
    return {
      positions: positions,
      indices: indices,
      normals: normals,
      n: n,
      box: domain,
    };
  }

  function build(elements, options) {
    const opts = options || {};
    const resolution = normalizeRes(opts.resolution);
    const domain = readBox(opts.box);
    const list = (elements || []).filter((el) => el && !el.deleted);
    if (!list.length) {
      throw new Error("Generate Geometry first.");
    }
    const n = divisionsFor(resolution);
    const grid = rasterize(list, domain, n);
    const raw = marchingCubes(grid);
    if (!raw.indices.length) throw new Error("Prep mesh is empty. Check that boxes sit inside the 20' module.");
    let welded = weldMesh(raw.positions, raw.indices, 1e-5);
    clampToBox(welded.positions, domain);
    welded = weldMesh(welded.positions, welded.indices, 1e-4);
    let positions = welded.positions;
    let indices = welded.indices;
    if (signedVolume(positions, indices) < 0) indices = flipIndices(indices);
    const normals = computeNormals(positions, indices);
    const validation = validateMesh(positions, indices, domain);
    return {
      positions,
      indices,
      normals,
      resolution,
      components: validation.components,
      validation,
      sourceHash: sourceHash(list),
      outOfDate: false,
      box: domain,
    };
  }

  function buildAsync(elements, options, onStatus) {
    const say = typeof onStatus === "function" ? onStatus : function () {};
    say("Preparing Mesh…");
    return new Promise((resolve, reject) => {
      const kick = () => {
        setTimeout(() => {
          try {
            resolve(build(elements, options));
          } catch (err) {
            reject(err);
          }
        }, 40);
      };
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(kick);
      else kick();
    });
  }

  global.D7PrepMesh = {
    CUBE,
    DIVS,
    normalizeRes,
    divisionsFor,
    sourceHash,
    extractIso,
    computeNormals,
    clampToBox,
    weldMesh,
    build,
    buildAsync,
    validateMesh,
  };
})(window);
