r"""Build the single hero environment used by the fireworks experience.

Run with Blender (not regular Python):

  blender -b --python scripts/build_hero_assets.py -- \
    --kit /path/to/Medieval\ Village\ MegaKit[Standard]/glTF \
    --output public/models/hero-world.glb

The generated GLB deliberately contains the authored PBR geometry. The runtime
only owns sky, water, atmosphere and reactive light; it no longer fabricates a
city out of boxes and cylinders.
"""

from __future__ import annotations

import argparse
import math
import re
import sys
from pathlib import Path
from typing import Iterable

import bpy
from mathutils import Euler, Matrix, Vector


WALL_HEIGHT = 3.123
MODULE_WIDTH = 2.0
KIT_DEFAULT = Path(
    "/private/tmp/medieval-megakit/Medieval Village MegaKit[Standard]/glTF"
)
def parse_args() -> argparse.Namespace:
    extra = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--kit", type=Path, default=KIT_DEFAULT)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--preview", type=Path)
    return parser.parse_args(extra)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):
        if collection.name != "Collection":
            bpy.data.collections.remove(collection)


def move_to_collection(obj: bpy.types.Object, collection: bpy.types.Collection) -> None:
    for current in list(obj.users_collection):
        current.objects.unlink(obj)
    collection.objects.link(obj)


def strip_blender_suffix(name: str) -> str:
    return re.sub(r"\.\d{3}$", "", name)


class ModuleLibrary:
    def __init__(
        self,
        source: Path,
        template_collection: bpy.types.Collection,
        output_collection: bpy.types.Collection,
    ) -> None:
        self.source = source
        self.template_collection = template_collection
        self.output_collection = output_collection
        self.templates: dict[str, list[bpy.types.Object]] = {}
        self.materials: dict[str, bpy.types.Material] = {}
        self.instance_counter = 0

    def load(self, name: str) -> list[bpy.types.Object]:
        if name in self.templates:
            return self.templates[name]
        path = self.source / f"{name}.gltf"
        if not path.exists():
            raise FileNotFoundError(path)
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(path))
        imported = [obj for obj in bpy.data.objects if obj not in before]
        meshes: list[bpy.types.Object] = []
        for obj in imported:
            if obj.type != "MESH":
                continue
            world = obj.matrix_world.copy()
            obj.parent = None
            obj.matrix_world = world
            obj.name = f"TEMPLATE_{name}_{len(meshes):02d}"
            self._canonicalize_materials(obj)
            move_to_collection(obj, self.template_collection)
            obj.hide_render = True
            obj.hide_viewport = True
            obj.select_set(False)
            meshes.append(obj)
        for obj in imported:
            if obj.type != "MESH":
                bpy.data.objects.remove(obj, do_unlink=True)
        if not meshes:
            raise RuntimeError(f"No mesh found in {path}")
        self.templates[name] = meshes
        return meshes

    def _canonicalize_materials(self, obj: bpy.types.Object) -> None:
        for index, material in enumerate(obj.data.materials):
            if material is None:
                continue
            key = strip_blender_suffix(material.name)
            canonical = self.materials.get(key)
            if canonical is None:
                material.name = key
                self.materials[key] = material
            elif material != canonical:
                obj.data.materials[index] = canonical

    def instance(
        self,
        name: str,
        location: tuple[float, float, float],
        rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
        scale: tuple[float, float, float] = (1.0, 1.0, 1.0),
        label: str | None = None,
        parent: bpy.types.Object | None = None,
    ) -> list[bpy.types.Object]:
        self.instance_counter += 1
        transform = (
            Matrix.Translation(location)
            @ Euler(rotation, "XYZ").to_matrix().to_4x4()
            @ Matrix.Diagonal((*scale, 1.0))
        )
        created: list[bpy.types.Object] = []
        for part_index, template in enumerate(self.load(name)):
            obj = template.copy()
            obj.data = template.data
            obj.name = (
                f"{label or name}_{self.instance_counter:04d}_{part_index:02d}"
            )
            self.output_collection.objects.link(obj)
            obj.hide_render = False
            obj.hide_viewport = False
            obj.matrix_world = transform @ template.matrix_world
            if parent is not None:
                keep_world = obj.matrix_world.copy()
                obj.parent = parent
                obj.matrix_world = keep_world
            created.append(obj)
        return created


def principled(material: bpy.types.Material) -> bpy.types.Node | None:
    if not material.use_nodes or material.node_tree is None:
        return None
    return material.node_tree.nodes.get("Principled BSDF")


def set_socket(node: bpy.types.Node | None, name: str, value: object) -> None:
    if node is not None and name in node.inputs:
        node.inputs[name].default_value = value


def make_material(
    name: str,
    color: tuple[float, float, float, float],
    roughness: float,
    metallic: float = 0.0,
    emission: tuple[float, float, float, float] | None = None,
    emission_strength: float = 0.0,
    sheen: float = 0.0,
) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    node = principled(material)
    set_socket(node, "Base Color", color)
    set_socket(node, "Roughness", roughness)
    set_socket(node, "Metallic", metallic)
    set_socket(node, "Coat Weight", 0.15 if metallic else 0.05)
    set_socket(node, "Sheen Weight", sheen)
    if emission is not None:
        set_socket(node, "Emission Color", emission)
        set_socket(node, "Emission Strength", emission_strength)
    return material


def tune_imported_materials(library: ModuleLibrary) -> None:
    tints: dict[str, tuple[float, float, float, float]] = {
        "MI_Plaster": (0.92, 0.67, 0.43, 1.0),
        "MI_UnevenBrick": (0.52, 0.62, 0.72, 1.0),
        "MI_Brick": (0.55, 0.61, 0.67, 1.0),
        "MI_RoundTiles": (0.88, 0.36, 0.22, 1.0),
        "MI_WoodTrim": (0.25, 0.16, 0.12, 1.0),
        "MI_WoodTrim_Wear": (0.38, 0.22, 0.15, 1.0),
        "MI_MetalOrnaments": (0.28, 0.20, 0.16, 1.0),
    }
    for name, tint in tints.items():
        node = principled(library.materials.get(name)) if name in library.materials else None
        set_socket(node, "Base Color", tint)
        if name == "MI_MetalOrnaments":
            set_socket(node, "Metallic", 0.72)
            set_socket(node, "Roughness", 0.38)
    glass = library.materials.get("MI_WindowGlass")
    node = principled(glass) if glass else None
    set_socket(node, "Base Color", (1.0, 0.36, 0.12, 1.0))
    set_socket(node, "Emission Color", (1.0, 0.13, 0.025, 1.0))
    set_socket(node, "Emission Strength", 4.2)
    set_socket(node, "Roughness", 0.28)


def create_root(name: str, collection: bpy.types.Collection) -> bpy.types.Object:
    root = bpy.data.objects.new(name, None)
    collection.objects.link(root)
    return root


def add_box(
    collection: bpy.types.Collection,
    name: str,
    location: tuple[float, float, float],
    size: tuple[float, float, float],
    material: bpy.types.Material,
    bevel: float = 0.08,
    bevel_segments: int = 3,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    parent: bpy.types.Object | None = None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = tuple(value / 2 for value in size)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    move_to_collection(obj, collection)
    obj.data.materials.append(material)
    if bevel > 0:
        modifier = obj.modifiers.new("Soft carved edges", "BEVEL")
        modifier.width = bevel
        modifier.segments = bevel_segments
        modifier.limit_method = "ANGLE"
        modifier.harden_normals = True
    if parent is not None:
        obj.parent = parent
    return obj


def add_uv_sphere(
    collection: bpy.types.Collection,
    name: str,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    material: bpy.types.Material,
    parent: bpy.types.Object | None = None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    move_to_collection(obj, collection)
    obj.data.materials.append(material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    if parent is not None:
        obj.parent = parent
    return obj


def add_cylinder(
    collection: bpy.types.Collection,
    name: str,
    location: tuple[float, float, float],
    radius: float,
    depth: float,
    material: bpy.types.Material,
    *,
    vertices: int = 48,
    bevel: float = 0.03,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    parent: bpy.types.Object | None = None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    move_to_collection(obj, collection)
    obj.data.materials.append(material)
    if bevel > 0:
        modifier = obj.modifiers.new("Machined edge bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = 4
        modifier.limit_method = "ANGLE"
        modifier.harden_normals = True
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    if parent is not None:
        obj.parent = parent
    return obj


def building(
    library: ModuleLibrary,
    parent: bpy.types.Object,
    label: str,
    x: float,
    y: float,
    width_modules: int,
    depth_modules: int,
    floors: int,
    roof: str,
    roof_z_offset: float = 0.78,
    wall: str = "Wall_Plaster_Window_Wide_Round",
    base_wall: str = "Wall_UnevenBrick_Window_Wide_Round",
    door: str = "Wall_Plaster_Door_RoundInset",
) -> None:
    width = width_modules * MODULE_WIDTH
    depth = depth_modules * MODULE_WIDTH
    for floor in range(floors):
        z = floor * WALL_HEIGHT
        for index in range(width_modules):
            px = x - width / 2 + MODULE_WIDTH / 2 + index * MODULE_WIDTH
            front_module = base_wall if floor == 0 else wall
            if floor == 0 and index == width_modules // 2:
                front_module = door
            library.instance(
                front_module,
                (px, y - depth / 2, z),
                label=f"{label}_front",
                parent=parent,
            )
            if floor > 0 and (index + floor) % 2 == 0:
                library.instance(
                    "WindowShutters_Wide_Round_Open",
                    (px, y - depth / 2 - 0.035, z),
                    label=f"{label}_front_shutters",
                    parent=parent,
                )
            library.instance(
                base_wall if floor == 0 else wall,
                (px, y + depth / 2, z),
                rotation=(0, 0, math.pi),
                label=f"{label}_rear",
                parent=parent,
            )
            if floor > 0 and (index + floor) % 2 == 1:
                library.instance(
                    "WindowShutters_Wide_Round_Open",
                    (px, y + depth / 2 + 0.035, z),
                    rotation=(0, 0, math.pi),
                    label=f"{label}_rear_shutters",
                    parent=parent,
                )
        for index in range(depth_modules):
            py = y - depth / 2 + MODULE_WIDTH / 2 + index * MODULE_WIDTH
            side_module = base_wall if floor == 0 else wall
            library.instance(
                side_module,
                (x - width / 2, py, z),
                rotation=(0, 0, -math.pi / 2),
                label=f"{label}_left",
                parent=parent,
            )
            library.instance(
                side_module,
                (x + width / 2, py, z),
                rotation=(0, 0, math.pi / 2),
                label=f"{label}_right",
                parent=parent,
            )
    library.instance(
        roof,
        (x, y, floors * WALL_HEIGHT + roof_z_offset),
        label=f"{label}_roof",
        parent=parent,
    )


def create_island(
    collection: bpy.types.Collection,
    parent: bpy.types.Object,
    rock: bpy.types.Material,
    grass: bpy.types.Material,
) -> None:
    segments = 72
    rings = [
        (0.25, 26.0, 18.0),
        (-1.1, 25.2, 17.4),
        (-3.5, 21.2, 14.3),
        (-6.4, 15.0, 10.0),
    ]
    vertices: list[tuple[float, float, float]] = []
    uvs: list[tuple[float, float]] = []
    for ring_index, (z, radius_x, radius_y) in enumerate(rings):
        for index in range(segments):
            angle = index / segments * math.tau
            ripple = 1.0 + 0.045 * math.sin(angle * 5.0 + ring_index) + 0.025 * math.sin(angle * 11.0)
            vertices.append((math.cos(angle) * radius_x * ripple, 43 + math.sin(angle) * radius_y * ripple, z))
            uvs.append((index / segments * 4.0, ring_index / (len(rings) - 1) * 2.2))
    faces: list[tuple[int, int, int, int]] = []
    for ring_index in range(len(rings) - 1):
        for index in range(segments):
            current = ring_index * segments + index
            following = ring_index * segments + (index + 1) % segments
            lower_following = (ring_index + 1) * segments + (index + 1) % segments
            lower = (ring_index + 1) * segments + index
            faces.append((current, following, lower_following, lower))
    mesh = bpy.data.meshes.new("Sculpted island cliff mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    uv_layer = mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            vertex_index = mesh.loops[loop_index].vertex_index
            uv_layer.data[loop_index].uv = uvs[vertex_index]
            polygon.use_smooth = True
    cliff = bpy.data.objects.new("PBR sculpted island cliffs", mesh)
    collection.objects.link(cliff)
    cliff.data.materials.append(rock)
    cliff.parent = parent

    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=1, depth=0.34, location=(0, 43, 0.38))
    top = bpy.context.object
    top.name = "Moonharbor garden plateau"
    top.scale = (25.8, 17.8, 1)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    move_to_collection(top, collection)
    top.data.materials.append(grass)
    bevel = top.modifiers.new("Weathered soft rim", "BEVEL")
    bevel.width = 0.65
    bevel.segments = 4
    top.parent = parent


def create_trees(
    collection: bpy.types.Collection,
    parent: bpy.types.Object,
    trunk: bpy.types.Material,
    leaves: tuple[bpy.types.Material, ...],
) -> None:
    positions = [
        (-19, 34, 0.8, 1.2), (-17, 47, 0.8, 1.0), (-13, 55, 0.8, 1.25),
        (14, 54, 0.8, 1.1), (19, 45, 0.8, 1.3), (18, 35, 0.8, 1.05),
    ]
    crown_offsets = (
        (-0.86, -0.08, 3.12, 0.72),
        (-0.46, 0.18, 3.48, 0.78),
        (0.02, -0.16, 3.18, 0.82),
        (0.52, 0.12, 3.45, 0.76),
        (0.88, -0.02, 3.08, 0.66),
        (-0.66, -0.06, 3.94, 0.68),
        (-0.18, 0.2, 4.05, 0.77),
        (0.38, -0.12, 4.03, 0.73),
        (0.7, 0.16, 3.82, 0.62),
        (-0.34, -0.04, 4.58, 0.61),
        (0.2, 0.12, 4.62, 0.67),
    )
    for index, (x, y, z, scale) in enumerate(positions):
        add_cylinder(
            collection,
            f"Carved tree trunk {index:02d}",
            (x, y, z + 1.5 * scale),
            0.2 * scale,
            3.0 * scale,
            trunk,
            vertices=28,
            bevel=0.035,
            parent=parent,
        )
        for branch_index, (dx, dy, dz, rx, ry) in enumerate(((-0.44, 0.0, 2.65, 0.0, -0.72), (0.38, 0.12, 2.95, 0.18, 0.68), (-0.1, -0.35, 3.25, -0.65, 0.18))):
            add_cylinder(
                collection,
                f"Tree branch {index:02d}-{branch_index}",
                (x + dx * scale * 0.42, y + dy * scale * 0.42, z + dz * scale),
                0.075 * scale,
                1.15 * scale,
                trunk,
                vertices=20,
                bevel=0.018,
                rotation=(rx, ry, 0),
                parent=parent,
            )
        for crown_index, (dx, dy, dz, crown_scale) in enumerate(crown_offsets):
            add_uv_sphere(
                collection,
                f"Dense tree crown {index:02d}-{crown_index}",
                (x + dx * scale, y + dy * scale, z + dz * scale),
                (0.82 * crown_scale * scale, 0.68 * crown_scale * scale, 0.88 * crown_scale * scale),
                leaves[(index + crown_index) % len(leaves)],
                parent,
            )


def create_city(
    library: ModuleLibrary,
    collection: bpy.types.Collection,
    parent: bpy.types.Object,
    materials: dict[str, bpy.types.Material],
) -> None:
    create_island(collection, parent, materials["rock"], materials["grass"])

    # Central romantic citadel: substantial silhouette, readable from the terrace,
    # and entirely made from authored textured modules.
    building(library, parent, "GrandKeep", 0, 45, 5, 7, 4, "Roof_RoundTiles_8x12")
    building(library, parent, "MoonSpire", 0, 46.5, 3, 3, 5, "Roof_Tower_RoundTiles")
    building(library, parent, "WestTower", -9, 42.5, 2, 2, 4, "Roof_Tower_RoundTiles")
    building(library, parent, "EastTower", 9, 42.5, 2, 2, 4, "Roof_Tower_RoundTiles")
    building(library, parent, "WestWing", -14, 47, 3, 4, 3, "Roof_RoundTiles_6x8")
    building(library, parent, "EastWing", 14, 47, 3, 4, 3, "Roof_RoundTiles_6x8")

    # The keep is the visual anchor from the seated camera. Layer authored
    # shutters, balconies, roof furniture and supports over the modular shell
    # so its facade holds up when the player zooms in for a photograph.
    for x in (-2.0, 0.0, 2.0):
        library.instance(
            "Balcony_Cross_Straight",
            (x, 37.82, WALL_HEIGHT * 2),
            label="GrandKeepGallery",
            parent=parent,
        )
    for x in (-2.05, 1.95):
        library.instance(
            "Roof_Dormer_RoundTile",
            (x, 39.1, WALL_HEIGHT * 4 + 1.82),
            label="GrandKeepDormer",
            parent=parent,
        )
    for x, y, floor in ((-14, 42.85, 3), (14, 42.85, 3)):
        library.instance(
            "Roof_Dormer_RoundTile",
            (x - 0.95, y, WALL_HEIGHT * floor + 1.35),
            scale=(0.82, 0.82, 0.82),
            label="WingDormer",
            parent=parent,
        )
    library.instance(
        "Roof_FrontSupports",
        (0, 37.9, WALL_HEIGHT * 4 - 0.1),
        scale=(0.92, 0.92, 0.92),
        label="GrandKeepEaves",
        parent=parent,
    )

    houses = [
        (-15.5, 35.2, 2, 3, 2, "Roof_RoundTiles_4x6"),
        (-10.4, 34.0, 2, 2, 2, "Roof_RoundTiles_4x4"),
        (-5.2, 34.2, 2, 3, 2, "Roof_RoundTiles_4x6"),
        (5.4, 34.3, 2, 3, 2, "Roof_RoundTiles_4x6"),
        (10.5, 34.0, 2, 2, 2, "Roof_RoundTiles_4x4"),
        (15.7, 35.3, 2, 3, 2, "Roof_RoundTiles_4x6"),
        (-19.2, 42.1, 2, 3, 2, "Roof_RoundTiles_4x6"),
        (19.2, 42.4, 2, 3, 2, "Roof_RoundTiles_4x6"),
        (-8.2, 56.0, 2, 3, 2, "Roof_RoundTiles_4x6"),
        (8.4, 56.1, 2, 3, 2, "Roof_RoundTiles_4x6"),
    ]
    for index, (x, y, width, depth, floors, roof) in enumerate(houses):
        building(library, parent, f"TownHouse{index:02d}", x, y, width, depth, floors, roof)
        library.instance("Prop_Chimney", (x + 0.7, y + 0.4, floors * WALL_HEIGHT + 1.0), scale=(0.72, 0.72, 0.72), label="Chimney", parent=parent)

    # Foreground city wall and a deep arch make the town feel inhabited rather
    # than like a set of disconnected doll houses.
    for index in range(22):
        x = -21 + index * 2
        if index in (10, 11):
            continue
        library.instance("Wall_UnevenBrick_Straight", (x, 29.2, 0.1), label="OuterWall", parent=parent)
    library.instance("Wall_Arch", (0, 29.15, 0.0), scale=(2.15, 1.0, 1.65), label="MoonGate", parent=parent)
    library.instance("Door_8_Round", (-0.02, 29.0, 0.15), scale=(0.9, 0.9, 1.45), label="MoonGateDoor", parent=parent)
    library.instance("Prop_Wagon", (-7.2, 31.25, 0.2), rotation=(0, 0, -0.26), scale=(0.78, 0.78, 0.78), label="MarketWagon", parent=parent)
    for index, (x, y, rotation) in enumerate(((-5.7, 31.0, 0.18), (-8.6, 31.55, -0.12), (6.9, 31.2, 0.28))):
        library.instance("Prop_Crate", (x, y, 0.2), rotation=(0, 0, rotation), scale=(0.72, 0.72, 0.72), label=f"MarketCrate{index:02d}", parent=parent)

    for x in (-22.5, 22.5):
        building(library, parent, f"WallTower{x:+.0f}", x, 30.3, 2, 2, 3, "Roof_Tower_RoundTiles")

    for name, x, y, z, rz, scale in [
        ("Prop_Vine1", -4.2, 38.0, 2.2, 0.0, 1.7),
        ("Prop_Vine4", 8.5, 40.4, 5.2, math.pi / 2, 1.5),
        ("Prop_Vine6", -13.8, 45.0, 4.4, -math.pi / 2, 1.4),
        ("Prop_Vine9", 15.2, 45.0, 3.4, math.pi / 2, 1.35),
    ]:
        library.instance(name, (x, y, z), rotation=(math.pi / 2, 0, rz), scale=(scale, scale, scale), label="Ivy", parent=parent)

    create_trees(
        collection,
        parent,
        materials["wood"],
        (materials["leaf"], materials["leaf_light"], materials["leaf_deep"]),
    )


def create_terrace(
    library: ModuleLibrary,
    collection: bpy.types.Collection,
    parent: bpy.types.Object,
    materials: dict[str, bpy.types.Material],
) -> None:
    for x_index in range(10):
        for y_index in range(7):
            library.instance(
                "Floor_Brick",
                (-9 + x_index * 2, -11 + y_index * 2, 0.15),
                label="TerracePaver",
                parent=parent,
            )
    for index in range(10):
        x = -9 + index * 2
        library.instance("Balcony_Simple_Straight", (x, 2.0, 0.2), label="FrontBalustrade", parent=parent)
    for side in (-10.0, 10.0):
        for index in range(6):
            y = -9.0 + index * 2
            library.instance(
                "Balcony_Simple_Straight",
                (side, y, 0.2),
                rotation=(0, 0, math.pi / 2 if side > 0 else -math.pi / 2),
                label="SideBalustrade",
                parent=parent,
            )

    # The lounge is the closest object to the camera, so it uses a layered,
    # high-segment construction instead of a single low-poly block. Individual
    # cushions, tufting, piping, arms and machined brass legs keep the silhouette
    # readable even when the camera is placed at seated eye level.
    add_box(
        collection,
        "Bench walnut lower frame",
        (0, -4.38, 0.82),
        (6.5, 1.28, 0.22),
        materials["lounge_wood"],
        0.09,
        bevel_segments=6,
        parent=parent,
    )
    add_box(
        collection,
        "Bench velvet upholstered base",
        (0, -4.32, 1.02),
        (6.22, 1.16, 0.24),
        materials["velvet_dark"],
        0.11,
        bevel_segments=6,
        parent=parent,
    )
    add_box(
        collection,
        "Bench walnut back rail",
        (0, -5.02, 1.72),
        (6.55, 0.18, 1.52),
        materials["lounge_wood"],
        0.075,
        bevel_segments=6,
        rotation=(math.radians(-6), 0, 0),
        parent=parent,
    )
    for x in (-2.7, 2.7):
        for y in (-4.75, -3.98):
            add_cylinder(
                collection,
                f"Bench machined brass leg {x:+.1f} {y:+.1f}",
                (x, y, 0.48),
                0.105,
                0.68,
                materials["metal"],
                vertices=64,
                bevel=0.025,
                parent=parent,
            )
            add_cylinder(
                collection,
                f"Bench brass foot {x:+.1f} {y:+.1f}",
                (x, y, 0.16),
                0.18,
                0.07,
                materials["metal"],
                vertices=64,
                bevel=0.018,
                parent=parent,
            )

    for index, x in enumerate((-2.08, 0.0, 2.08)):
        add_box(
            collection,
            f"Velvet seat cushion {index + 1}",
            (x, -4.21, 1.22),
            (1.92, 1.03, 0.27),
            materials["velvet"],
            0.17,
            bevel_segments=8,
            parent=parent,
        )
        add_box(
            collection,
            f"Velvet tufted back cushion {index + 1}",
            (x, -4.87, 1.82),
            (1.92, 0.31, 1.18),
            materials["velvet"],
            0.16,
            bevel_segments=8,
            rotation=(math.radians(-6), 0, 0),
            parent=parent,
        )
        for button_x in (x - 0.43, x + 0.43):
            for button_z in (1.6, 1.98):
                add_uv_sphere(
                    collection,
                    f"Velvet tuft button {index + 1}",
                    (button_x, -4.69, button_z),
                    (0.052, 0.028, 0.052),
                    materials["velvet_dark"],
                    parent,
                )

    for x in (-3.12, 3.12):
        add_box(
            collection,
            f"Bench rolled arm {x:+.1f}",
            (x, -4.25, 1.36),
            (0.34, 1.25, 0.48),
            materials["velvet_dark"],
            0.16,
            bevel_segments=8,
            parent=parent,
        )
        add_box(
            collection,
            f"Bench brass arm inlay {x:+.1f}",
            (x, -3.72, 1.37),
            (0.37, 0.045, 0.31),
            materials["metal"],
            0.022,
            bevel_segments=5,
            parent=parent,
        )

    # A framed woven rug and a small drinks table add believable domestic scale
    # while keeping the empty terrace calm and inviting.
    add_box(collection, "Woven night carpet", (0, -7.2, 0.2), (5.4, 3.4, 0.07), materials["carpet"], 0.035, bevel_segments=4, parent=parent)
    for x in (-2.57, 2.57):
        add_box(collection, f"Carpet woven side border {x:+.1f}", (x, -7.2, 0.245), (0.12, 3.18, 0.018), materials["carpet_trim"], 0.02, bevel_segments=3, parent=parent)
    for y in (-8.77, -5.63):
        add_box(collection, f"Carpet woven end border {y:+.1f}", (0, y, 0.245), (5.02, 0.12, 0.018), materials["carpet_trim"], 0.02, bevel_segments=3, parent=parent)

    add_cylinder(collection, "Walnut drinks table top", (-4.15, -4.25, 1.02), 0.72, 0.11, materials["lounge_wood"], vertices=72, bevel=0.045, parent=parent)
    add_cylinder(collection, "Brass drinks table stem", (-4.15, -4.25, 0.61), 0.075, 0.76, materials["metal"], vertices=48, bevel=0.02, parent=parent)
    add_cylinder(collection, "Brass drinks table foot", (-4.15, -4.25, 0.24), 0.42, 0.075, materials["metal"], vertices=72, bevel=0.028, parent=parent)
    for x in (-4.34, -3.96):
        add_cylinder(collection, f"Two person glass stem {x:+.2f}", (x, -4.25, 1.17), 0.018, 0.22, materials["glass"], vertices=32, bevel=0.006, parent=parent)
        add_cylinder(collection, f"Two person glass bowl {x:+.2f}", (x, -4.25, 1.31), 0.095, 0.18, materials["glass"], vertices=48, bevel=0.012, parent=parent)

    for x in (-7.8, 7.8):
        add_cylinder(collection, f"Lantern carved stone plinth {x:+.1f}", (x, 0.75, 0.55), 0.42, 1.0, materials["stone_detail"], vertices=64, bevel=0.065, parent=parent)
        add_cylinder(collection, f"Lantern warm glass {x:+.1f}", (x, 0.75, 1.28), 0.23, 0.48, materials["lantern"], vertices=48, bevel=0.035, parent=parent)
        add_cylinder(collection, f"Lantern brass cap {x:+.1f}", (x, 0.75, 1.58), 0.33, 0.13, materials["metal"], vertices=64, bevel=0.028, parent=parent)


def add_preview_light(
    collection: bpy.types.Collection,
    name: str,
    light_type: str,
    location: tuple[float, float, float],
    color: tuple[float, float, float],
    energy: float,
    size: float = 5.0,
) -> bpy.types.Object:
    data = bpy.data.lights.new(name, light_type)
    data.color = color
    data.energy = energy
    if hasattr(data, "shape"):
        data.shape = "DISK"
    if hasattr(data, "size"):
        data.size = size
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    obj.location = location
    return obj


def aim_at(obj: bpy.types.Object, target: Iterable[float]) -> None:
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def render_preview(path: Path, collection: bpy.types.Collection) -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1440
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(path)
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.look = "AgX - Medium High Contrast"
    world = bpy.data.worlds.new("Preview moon sky") if scene.world is None else scene.world
    scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.005, 0.009, 0.032, 1)
    background.inputs["Strength"].default_value = 0.42

    camera_data = bpy.data.cameras.new("Preview first-person camera")
    camera = bpy.data.objects.new("Preview first-person camera", camera_data)
    collection.objects.link(camera)
    camera.location = (-0.72, -3.65, 1.82)
    camera_data.lens = 29
    camera_data.sensor_width = 36
    aim_at(camera, (0, 35, 10.5))
    scene.camera = camera

    moon = add_preview_light(collection, "Preview moon", "AREA", (-24, 15, 36), (0.45, 0.62, 1.0), 3800, 12)
    aim_at(moon, (0, 42, 5))
    warm = add_preview_light(collection, "Preview city warmth", "AREA", (12, 26, 18), (1.0, 0.26, 0.08), 2300, 10)
    aim_at(warm, (0, 43, 6))
    fill = add_preview_light(collection, "Preview terrace fill", "AREA", (-6, -2, 8), (0.42, 0.58, 1.0), 1450, 7)
    aim_at(fill, (0, -4, 1.2))
    bpy.ops.render.render(write_still=True)


def select_hierarchy(root: bpy.types.Object) -> None:
    root.select_set(True)
    for child in root.children_recursive:
        child.select_set(True)


def export_glb(path: Path, root: bpy.types.Object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    select_hierarchy(root)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_animations=False,
        export_skins=False,
        export_materials="EXPORT",
        export_image_format="WEBP",
        export_image_quality=88,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=7,
        export_cameras=False,
        export_lights=False,
    )


def main() -> None:
    args = parse_args()
    if not args.kit.exists():
        raise FileNotFoundError(args.kit)
    clear_scene()
    scene_collection = bpy.context.scene.collection
    templates = bpy.data.collections.new("SOURCE TEMPLATES - NOT EXPORTED")
    hero_collection = bpy.data.collections.new("Hero world")
    preview_collection = bpy.data.collections.new("Preview only")
    scene_collection.children.link(templates)
    scene_collection.children.link(hero_collection)
    scene_collection.children.link(preview_collection)
    root = create_root("Moonharbor Hero World", hero_collection)
    library = ModuleLibrary(args.kit, templates, hero_collection)

    # Preload the materials used by custom geometry, then tune the shared art
    # direction once for every instance in the scene.
    for module in (
        "Wall_Plaster_Window_Wide_Round",
        "Wall_UnevenBrick_Window_Wide_Round",
        "Roof_RoundTiles_8x12",
        "Floor_Brick",
        "Floor_WoodDark",
        "Prop_MetalFence_Ornament",
        "Prop_Brick1",
    ):
        library.load(module)
    tune_imported_materials(library)

    lounge_glass = make_material(
        "Smoked crystal glass",
        (0.42, 0.55, 0.68, 1.0),
        0.12,
    )
    glass_shader = principled(lounge_glass)
    set_socket(glass_shader, "Transmission Weight", 0.72)
    set_socket(glass_shader, "IOR", 1.46)
    lounge_glass.surface_render_method = "DITHERED"

    materials = {
        "rock": library.materials.get("MI_UnevenBrick") or make_material("Moon rock", (0.24, 0.32, 0.42, 1), 0.92),
        "wood": library.materials.get("MI_WoodTrim") or make_material("Dark oak", (0.14, 0.07, 0.04, 1), 0.78),
        "grass": make_material("Moonlit garden grass", (0.055, 0.18, 0.13, 1), 0.93),
        "leaf": make_material("Deep emerald foliage", (0.025, 0.15, 0.11, 1), 0.88, sheen=0.08),
        "leaf_light": make_material("Moonlit emerald foliage", (0.045, 0.23, 0.16, 1), 0.86, sheen=0.1),
        "leaf_deep": make_material("Shadow emerald foliage", (0.012, 0.075, 0.055, 1), 0.91, sheen=0.05),
        "metal": make_material("Aged romantic brass", (0.22, 0.12, 0.055, 1), 0.34, 0.78),
        "lounge_wood": make_material("Hand finished walnut", (0.075, 0.024, 0.011, 1), 0.34, sheen=0.03),
        "velvet": make_material("Berry moon velvet", (0.15, 0.012, 0.052, 1), 0.72, sheen=0.58),
        "velvet_dark": make_material("Deep berry velvet piping", (0.045, 0.003, 0.014, 1), 0.76, sheen=0.46),
        "carpet": make_material("Midnight woven carpet", (0.07, 0.035, 0.12, 1), 0.94, sheen=0.2),
        "carpet_trim": make_material("Woven carpet border", (0.32, 0.13, 0.21, 1), 0.9, sheen=0.16),
        "stone_detail": make_material("Fine cut blue limestone", (0.15, 0.19, 0.25, 1), 0.82),
        "glass": lounge_glass,
        "lantern": make_material("Warm lantern glass", (1.0, 0.22, 0.045, 1), 0.26, emission=(1.0, 0.06, 0.01, 1), emission_strength=5.2),
    }

    create_city(library, hero_collection, root, materials)
    create_terrace(library, hero_collection, root, materials)
    tune_imported_materials(library)

    if args.preview:
        args.preview.parent.mkdir(parents=True, exist_ok=True)
        render_preview(args.preview, preview_collection)
    export_glb(args.output, root)
    print(f"HERO_ASSET={args.output}")
    print(f"HERO_ASSET_BYTES={args.output.stat().st_size}")
    if args.preview:
        print(f"HERO_PREVIEW={args.preview}")


if __name__ == "__main__":
    main()
