import os

pipeline_path = os.path.join('algo', 'pipeline.js')
with open(pipeline_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if 'console.log' in line:
        print(f"{i + 1}: {line.strip()}")
